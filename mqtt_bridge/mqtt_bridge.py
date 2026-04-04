"""GROUNDLINK MQTT Bridge — Aggregates multi-SDR data for the dashboard.

Subscribes to all MQTT topics from SDR fleet nodes, maintains in-memory
state, and exposes:
  - WebSocket on port 8790: real-time multiplexed SDR data
  - HTTP API on port 8791: fleet status, merged aircraft, detections

Usage:
    python mqtt_bridge.py [--mqtt-broker mosquitto] [--ws-port 8790] [--http-port 8791]
"""

import asyncio
import json
import logging
import os
import time
from collections import defaultdict

import click
from aiohttp import web

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("mqtt-bridge")


class FleetState:
    """In-memory state aggregated from MQTT messages."""

    def __init__(self):
        # Per-node, per-SDR status
        self.node_status: dict[str, dict] = {}
        # Per-node, per-SDR latest data
        self.sdr_data: dict[str, dict[int, dict]] = defaultdict(dict)
        # Merged aircraft (deduplicated by ICAO across all ADS-B SDRs)
        self.aircraft: dict[str, dict] = {}
        # Recent scanner detections
        self.detections: list[dict] = []
        self.max_detections = 500
        # Connected WebSocket clients
        self.ws_clients: set = set()

    def update_node_status(self, node_id: str, status: dict):
        self.node_status[node_id] = status

    def update_sdr_data(self, node_id: str, device_index: int,
                        mode: str, data_type: str, data: dict):
        key = f"{node_id}:{device_index}"

        # Store latest data per SDR
        self.sdr_data[node_id][device_index] = {
            "mode": mode,
            "data_type": data_type,
            "data": data,
            "updated_at": time.time(),
        }

        # Merge aircraft from ADS-B feeds
        if mode == "adsb" and data_type == "aircraft":
            ac_list = data.get("aircraft", [])
            for ac in ac_list:
                icao = ac.get("icao", "").upper()
                if icao:
                    ac["_source_sdr"] = device_index
                    ac["_source_node"] = node_id
                    # Keep the most recent data per ICAO
                    existing = self.aircraft.get(icao)
                    if not existing or ac.get("msgs", 0) >= existing.get("msgs", 0):
                        self.aircraft[icao] = ac

        # Collect scanner detections
        if mode == "scanner" and data_type == "detection":
            data["_source_sdr"] = device_index
            data["_source_node"] = node_id
            self.detections.append(data)
            if len(self.detections) > self.max_detections:
                self.detections = self.detections[-self.max_detections:]

    def get_merged_aircraft(self) -> list[dict]:
        # Remove stale aircraft (no update in 60s)
        cutoff = time.time() - 60
        stale = [
            icao for icao, ac in self.aircraft.items()
            if self.sdr_data.get(ac.get("_source_node", ""), {})
                .get(ac.get("_source_sdr", -1), {})
                .get("updated_at", 0) < cutoff
        ]
        for icao in stale:
            del self.aircraft[icao]
        return list(self.aircraft.values())

    def get_fleet_overview(self) -> dict:
        nodes = {}
        for node_id, status in self.node_status.items():
            nodes[node_id] = {
                "status": status,
                "sdr_count": len(self.sdr_data.get(node_id, {})),
                "last_update": max(
                    (s.get("updated_at", 0) for s in self.sdr_data.get(node_id, {}).values()),
                    default=0,
                ),
            }
        return {
            "nodes": nodes,
            "total_aircraft": len(self.aircraft),
            "total_detections": len(self.detections),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }


state = FleetState()


# ── MQTT Subscriber ──

async def mqtt_loop(broker: str, port: int):
    """Subscribe to groundlink/# and route messages to state."""
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        logger.error("paho-mqtt not installed. Run: pip install paho-mqtt")
        return

    def on_connect(client, userdata, flags, reason_code, properties=None):
        logger.info("MQTT connected to %s:%d", broker, port)
        client.subscribe("groundlink/#")

    def on_message(client, userdata, msg):
        try:
            topic_parts = msg.topic.split("/")
            payload = json.loads(msg.payload.decode("utf-8"))

            # groundlink/{node_id}/status
            if len(topic_parts) == 3 and topic_parts[2] == "status":
                node_id = topic_parts[1]
                state.update_node_status(node_id, payload)
                broadcast_sync(json.dumps({
                    "type": "fleet_status",
                    "node_id": node_id,
                    **payload,
                }))

            # groundlink/{node_id}/sdr/{device}/{mode}/{data_type}
            elif len(topic_parts) == 6 and topic_parts[2] == "sdr":
                node_id = topic_parts[1]
                device_index = int(topic_parts[3])
                mode = topic_parts[4]
                data_type = topic_parts[5]

                state.update_sdr_data(node_id, device_index, mode, data_type, payload)

                # Forward to WebSocket clients with metadata
                broadcast_sync(json.dumps({
                    "type": "sdr_data",
                    "node_id": node_id,
                    "sdr_index": device_index,
                    "mode": mode,
                    "data_type": data_type,
                    "data": payload,
                }))

        except Exception as e:
            logger.debug("MQTT message parse error: %s", e)

    client = mqtt.Client(
        client_id="groundlink-bridge",
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )
    client.on_connect = on_connect
    client.on_message = on_message

    while True:
        try:
            client.connect(broker, port, keepalive=60)
            client.loop_start()
            logger.info("MQTT subscriber started, waiting for messages...")
            # Keep alive — reconnection handled by paho
            while True:
                await asyncio.sleep(10)
        except Exception as e:
            logger.warning("MQTT connection error: %s — retrying in 5s", e)
            await asyncio.sleep(5)


# Sync broadcast helper (called from MQTT thread)
_loop: asyncio.AbstractEventLoop | None = None
_broadcast_queue: asyncio.Queue | None = None


def broadcast_sync(message: str):
    """Thread-safe broadcast to WebSocket clients."""
    if _broadcast_queue and _loop:
        _loop.call_soon_threadsafe(_broadcast_queue.put_nowait, message)


async def ws_broadcaster():
    """Async task that reads from queue and sends to WS clients."""
    while True:
        message = await _broadcast_queue.get()
        dead = set()
        for ws in state.ws_clients:
            try:
                await ws.send_str(message)
            except Exception:
                dead.add(ws)
        state.ws_clients -= dead


# ── WebSocket Handler ──

async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    state.ws_clients.add(ws)
    logger.info("WS client connected (%d total)", len(state.ws_clients))

    # Send initial state
    try:
        await ws.send_json({
            "type": "init",
            "fleet": state.get_fleet_overview(),
            "aircraft": state.get_merged_aircraft(),
        })
    except Exception:
        pass

    try:
        async for msg in ws:
            pass  # Read-only for now
    except Exception:
        pass
    finally:
        state.ws_clients.discard(ws)
        logger.info("WS client disconnected (%d remaining)", len(state.ws_clients))

    return ws


# ── HTTP API ──

async def handle_fleet(request: web.Request) -> web.Response:
    return web.json_response(state.get_fleet_overview())


async def handle_aircraft(request: web.Request) -> web.Response:
    aircraft = state.get_merged_aircraft()
    return web.json_response({
        "aircraft": aircraft,
        "count": len(aircraft),
    })


async def handle_detections(request: web.Request) -> web.Response:
    limit = int(request.query.get("limit", 100))
    return web.json_response({
        "detections": state.detections[-limit:],
        "count": len(state.detections),
    })


async def handle_sdr(request: web.Request) -> web.Response:
    node_id = request.match_info.get("node_id")
    device = request.match_info.get("device")

    if node_id and device:
        device_int = int(device)
        data = state.sdr_data.get(node_id, {}).get(device_int)
        if data:
            return web.json_response(data)
        return web.json_response({"error": "Not found"}, status=404)

    # Return all SDR data
    result = {}
    for nid, sdrs in state.sdr_data.items():
        result[nid] = {str(k): v for k, v in sdrs.items()}
    return web.json_response(result)


async def handle_nodes(request: web.Request) -> web.Response:
    return web.json_response(state.node_status)


def build_app() -> web.Application:
    app = web.Application()

    @web.middleware
    async def cors(request: web.Request, handler):
        if request.method == "OPTIONS":
            resp = web.Response()
        else:
            resp = await handler(request)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return resp

    app.middlewares.append(cors)

    # WebSocket endpoint
    app.router.add_get("/ws", ws_handler)

    # REST endpoints
    app.router.add_get("/api/fleet", handle_fleet)
    app.router.add_get("/api/aircraft", handle_aircraft)
    app.router.add_get("/api/detections", handle_detections)
    app.router.add_get("/api/nodes", handle_nodes)
    app.router.add_get("/api/sdr", handle_sdr)
    app.router.add_get("/api/sdr/{node_id}/{device}", handle_sdr)

    return app


@click.command()
@click.option("--mqtt-broker", default=None, help="MQTT broker host")
@click.option("--mqtt-port", type=int, default=None, help="MQTT broker port")
@click.option("--http-port", type=int, default=8791, help="HTTP API port")
@click.option("--ws-port", type=int, default=8790, help="WebSocket port")
def main(mqtt_broker, mqtt_port, http_port, ws_port):
    """GROUNDLINK MQTT Bridge — Multi-SDR data aggregator."""
    global _loop, _broadcast_queue

    broker = mqtt_broker or os.environ.get("MQTT_BROKER", "localhost")
    port = mqtt_port or int(os.environ.get("MQTT_PORT", 1883))

    async def run():
        global _loop, _broadcast_queue
        _loop = asyncio.get_event_loop()
        _broadcast_queue = asyncio.Queue()

        logger.info("=" * 60)
        logger.info("GROUNDLINK MQTT Bridge")
        logger.info("MQTT: %s:%d", broker, port)
        logger.info("WebSocket: ws://0.0.0.0:%d/ws", ws_port)
        logger.info("HTTP API: http://0.0.0.0:%d", http_port)
        logger.info("=" * 60)

        # Start MQTT subscriber
        mqtt_task = asyncio.create_task(mqtt_loop(broker, port))

        # Start WebSocket broadcaster
        broadcaster_task = asyncio.create_task(ws_broadcaster())

        # Start HTTP+WS server (both on ws_port)
        # We serve WS on ws_port and HTTP on http_port
        ws_app = web.Application()

        @web.middleware
        async def cors(request: web.Request, handler):
            if request.method == "OPTIONS":
                resp = web.Response()
            else:
                resp = await handler(request)
            resp.headers["Access-Control-Allow-Origin"] = "*"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
            return resp

        ws_app.middlewares.append(cors)
        ws_app.router.add_get("/ws", ws_handler)
        ws_app.router.add_get("/", ws_handler)  # Allow root path too

        ws_runner = web.AppRunner(ws_app)
        await ws_runner.setup()
        ws_site = web.TCPSite(ws_runner, "0.0.0.0", ws_port)
        await ws_site.start()

        # HTTP API
        http_app = build_app()
        http_runner = web.AppRunner(http_app)
        await http_runner.setup()
        http_site = web.TCPSite(http_runner, "0.0.0.0", http_port)
        await http_site.start()

        try:
            await asyncio.Future()
        except (asyncio.CancelledError, KeyboardInterrupt):
            pass
        finally:
            mqtt_task.cancel()
            broadcaster_task.cancel()
            await ws_runner.cleanup()
            await http_runner.cleanup()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        logger.info("Bridge shutting down")


if __name__ == "__main__":
    main()
