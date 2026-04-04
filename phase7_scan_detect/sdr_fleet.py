"""GROUNDLINK SDR Fleet Manager — Multi-SDR process manager with MQTT.

Manages multiple RTL-SDR dongles running in parallel on a single host
(typically a Raspberry Pi). Each SDR runs its own backend process
(adsb, scanner, radio) and data is published to an MQTT broker.

Usage:
    python sdr_fleet.py [--config fleet_config.yaml] [--port 8780]

Architecture:
    - Reads fleet_config.yaml for SDR assignments
    - Spawns one subprocess per enabled SDR device
    - Connects each backend's WebSocket output to MQTT publish
    - Publishes heartbeat to groundlink/{node_id}/status
    - HTTP API for remote fleet management
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from pathlib import Path

import click
import yaml
from aiohttp import web

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("sdr-fleet")

SCRIPT_DIR = Path(__file__).parent.resolve()

# Platform-aware binary names
IS_WINDOWS = sys.platform == "win32"
EXE_SUFFIX = ".exe" if IS_WINDOWS else ""
PATH_SEP = ";" if IS_WINDOWS else ":"

# RTL-SDR library path (overridable via env)
RTLSDR_DIR = os.environ.get(
    "RTLSDR_DIR",
    r"D:\tools\rtl-sdr\x64" if IS_WINDOWS else "/usr/local/lib",
)

MAX_LOG_LINES = 80


class SdrInstance:
    """Manages a single SDR backend process."""

    def __init__(self, device_index: int, mode: str, label: str, config: dict):
        self.device_index = device_index
        self.mode = mode
        self.label = label
        self.config = config
        self.proc: asyncio.subprocess.Process | None = None
        self.started_at: float | None = None
        self.log: list[str] = []
        self._log_tasks: list[asyncio.Task] = []

    def _push_log(self, line: str):
        self.log.append(line)
        if len(self.log) > MAX_LOG_LINES:
            self.log = self.log[-MAX_LOG_LINES:]

    def is_running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    def status(self) -> dict:
        return {
            "device_index": self.device_index,
            "mode": self.mode,
            "label": self.label,
            "running": self.is_running(),
            "pid": self.proc.pid if self.is_running() else None,
            "uptime_s": int(time.time() - self.started_at) if self.is_running() and self.started_at else 0,
            "log": self.log[-20:],
        }

    async def start(self) -> dict:
        if self.is_running():
            return {"ok": True, "message": f"SDR {self.device_index} already running"}

        self.log = []
        env = self._build_env()
        cmd = self._build_command()
        self._push_log(f"Starting {self.mode} on device {self.device_index}: {' '.join(cmd)}")

        try:
            self.proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(SCRIPT_DIR),
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except Exception as e:
            self._push_log(f"Spawn failed: {e}")
            return {"ok": False, "message": str(e)}

        self.started_at = time.time()

        self._log_tasks = [
            asyncio.create_task(self._read_stream(self.proc.stdout, "out")),
            asyncio.create_task(self._read_stream(self.proc.stderr, "log")),
            asyncio.create_task(self._watch_exit()),
        ]

        # Give it a moment to fail fast
        await asyncio.sleep(0.6)

        if self.is_running():
            return {"ok": True, "message": f"SDR {self.device_index} ({self.mode}) started", "pid": self.proc.pid}
        else:
            self.started_at = None
            return {"ok": False, "message": f"SDR {self.device_index} exited immediately — check log"}

    async def stop(self) -> dict:
        if not self.is_running():
            self.proc = None
            self.started_at = None
            return {"ok": True, "stopped": self.mode}

        pid = self.proc.pid
        self._push_log(f"Stopping {self.mode} (PID {pid})...")

        for t in self._log_tasks:
            t.cancel()
        self._log_tasks.clear()

        try:
            if IS_WINDOWS:
                import subprocess
                subprocess.run(
                    ["taskkill", "/PID", str(pid), "/T", "/F"],
                    capture_output=True, timeout=5,
                )
            else:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
        except Exception as e:
            self._push_log(f"Kill error: {e}")
            try:
                self.proc.terminate()
            except Exception:
                pass

        try:
            await asyncio.wait_for(self.proc.wait(), timeout=3.0)
        except asyncio.TimeoutError:
            try:
                self.proc.kill()
                await self.proc.wait()
            except Exception:
                pass

        self._push_log(f"{self.mode} stopped.")
        self.proc = None
        self.started_at = None
        return {"ok": True, "stopped": self.mode}

    def _build_env(self) -> dict:
        env = os.environ.copy()
        if RTLSDR_DIR not in env.get("PATH", ""):
            env["PATH"] = RTLSDR_DIR + PATH_SEP + env.get("PATH", "")
        if not IS_WINDOWS:
            env["LD_LIBRARY_PATH"] = RTLSDR_DIR + ":" + env.get("LD_LIBRARY_PATH", "")
        return env

    def _build_command(self) -> list[str]:
        cfg = self.config

        if self.mode == "adsb":
            return [
                sys.executable,
                str(SCRIPT_DIR / "adsb_server.py"),
                "--port", str(cfg.get("port", 8771 + self.device_index)),
                "--gain", str(cfg.get("gain", 496)),
                "--device", str(self.device_index),
            ]
        elif self.mode == "scanner":
            cmd = [
                sys.executable,
                str(SCRIPT_DIR / "scanner.py"),
                "--device", str(self.device_index),
            ]
            if cfg.get("mock"):
                cmd.append("--mock")
            if cfg.get("scan_mode"):
                cmd.extend(["--mode", cfg["scan_mode"]])
            if cfg.get("start_freq"):
                cmd.extend(["--start-freq", str(cfg["start_freq"])])
            if cfg.get("stop_freq"):
                cmd.extend(["--stop-freq", str(cfg["stop_freq"])])
            if cfg.get("watch_freq"):
                cmd.extend(["--watch-freq", str(cfg["watch_freq"])])
            return cmd
        elif self.mode == "radio":
            return [
                sys.executable,
                str(SCRIPT_DIR / "radio_server.py"),
                "--port", str(cfg.get("port", 8770)),
                "--freq", str(cfg.get("freq", 94.9)),
                "--mode", cfg.get("demod", "wfm"),
                "--device", str(self.device_index),
            ]
        else:
            raise ValueError(f"Unknown mode: {self.mode}")

    async def _read_stream(self, stream, prefix: str):
        try:
            while True:
                line = await stream.readline()
                if not line:
                    break
                self._push_log(f"[{prefix}] {line.decode('utf-8', errors='replace').rstrip()}")
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async def _watch_exit(self):
        try:
            code = await self.proc.wait()
            self._push_log(f"{self.mode} exited (code {code})")
            self.proc = None
            self.started_at = None
        except asyncio.CancelledError:
            pass


class MqttPublisher:
    """Publishes SDR data to MQTT broker."""

    def __init__(self, broker: str, port: int, client_id: str, node_id: str):
        self.broker = broker
        self.port = port
        self.client_id = client_id
        self.node_id = node_id
        self.client = None
        self._connected = False

    async def connect(self):
        try:
            import paho.mqtt.client as mqtt

            self.client = mqtt.Client(
                client_id=self.client_id,
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            )

            def on_connect(client, userdata, flags, reason_code, properties=None):
                self._connected = True
                logger.info("MQTT connected to %s:%d", self.broker, self.port)

            def on_disconnect(client, userdata, flags, reason_code, properties=None):
                self._connected = False
                logger.warning("MQTT disconnected (rc=%s)", reason_code)

            self.client.on_connect = on_connect
            self.client.on_disconnect = on_disconnect
            self.client.connect_async(self.broker, self.port, keepalive=60)
            self.client.loop_start()
        except ImportError:
            logger.warning("paho-mqtt not installed — MQTT disabled. Install with: pip install paho-mqtt")
        except Exception as e:
            logger.warning("MQTT connection failed: %s", e)

    def publish(self, topic: str, payload: dict | str):
        if self.client and self._connected:
            msg = payload if isinstance(payload, str) else json.dumps(payload)
            self.client.publish(topic, msg)

    def publish_sdr_data(self, device_index: int, mode: str, data_type: str, payload: dict):
        topic = f"groundlink/{self.node_id}/sdr/{device_index}/{mode}/{data_type}"
        self.publish(topic, payload)

    def publish_heartbeat(self, fleet_status: dict):
        topic = f"groundlink/{self.node_id}/status"
        self.publish(topic, fleet_status)

    async def disconnect(self):
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()


class SdrFleetManager:
    """Manages multiple SDR instances running in parallel."""

    def __init__(self, config: dict):
        self.config = config
        self.node_id = config.get("node_id", "pi-roof")
        self.sdrs: dict[int, SdrInstance] = {}
        self.mqtt: MqttPublisher | None = None
        self._heartbeat_task: asyncio.Task | None = None
        self._ws_bridge_tasks: list[asyncio.Task] = []

        # Create SDR instances from config
        for sdr_cfg in config.get("sdrs", []):
            if not sdr_cfg.get("enabled", True):
                continue
            idx = sdr_cfg["device_index"]
            self.sdrs[idx] = SdrInstance(
                device_index=idx,
                mode=sdr_cfg["mode"],
                label=sdr_cfg.get("label", f"SDR {idx}"),
                config=sdr_cfg.get("config", {}),
            )

    async def start_all(self):
        """Start MQTT and all enabled SDR instances."""
        # Connect MQTT
        mqtt_cfg = self.config.get("mqtt", {})
        broker = os.environ.get("MQTT_BROKER", mqtt_cfg.get("broker", "localhost"))
        port = int(os.environ.get("MQTT_PORT", mqtt_cfg.get("port", 1883)))
        client_id = os.environ.get("MQTT_CLIENT_ID", mqtt_cfg.get("client_id", self.node_id))

        self.mqtt = MqttPublisher(broker, port, client_id, self.node_id)
        await self.mqtt.connect()

        # Start all SDR instances
        results = {}
        for idx, sdr in self.sdrs.items():
            logger.info("Starting SDR %d: %s (%s)", idx, sdr.label, sdr.mode)
            result = await sdr.start()
            results[idx] = result
            logger.info("SDR %d: %s", idx, result.get("message", "unknown"))
            # Stagger starts to avoid USB contention
            await asyncio.sleep(1.0)

        # Start WebSocket bridge tasks for each SDR
        for idx, sdr in self.sdrs.items():
            if sdr.is_running():
                task = asyncio.create_task(self._ws_bridge(sdr))
                self._ws_bridge_tasks.append(task)

        # Start heartbeat
        interval = self.config.get("heartbeat_interval_s", 10)
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop(interval))

        return results

    async def stop_all(self):
        """Stop all SDR instances and MQTT."""
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        for t in self._ws_bridge_tasks:
            t.cancel()
        self._ws_bridge_tasks.clear()

        for idx, sdr in self.sdrs.items():
            logger.info("Stopping SDR %d...", idx)
            await sdr.stop()

        if self.mqtt:
            await self.mqtt.disconnect()

    async def start_sdr(self, device_index: int) -> dict:
        sdr = self.sdrs.get(device_index)
        if not sdr:
            return {"ok": False, "message": f"No SDR configured for device {device_index}"}
        result = await sdr.start()
        if sdr.is_running():
            task = asyncio.create_task(self._ws_bridge(sdr))
            self._ws_bridge_tasks.append(task)
        return result

    async def stop_sdr(self, device_index: int) -> dict:
        sdr = self.sdrs.get(device_index)
        if not sdr:
            return {"ok": False, "message": f"No SDR configured for device {device_index}"}
        return await sdr.stop()

    async def reconfigure_sdr(self, device_index: int, mode: str, config: dict) -> dict:
        """Stop, reconfigure, and restart an SDR."""
        sdr = self.sdrs.get(device_index)
        if not sdr:
            return {"ok": False, "message": f"No SDR configured for device {device_index}"}
        await sdr.stop()
        await asyncio.sleep(0.8)  # USB release
        sdr.mode = mode
        sdr.config = config
        return await sdr.start()

    def fleet_status(self) -> dict:
        return {
            "node_id": self.node_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "mqtt_connected": self.mqtt._connected if self.mqtt else False,
            "sdrs": {str(idx): sdr.status() for idx, sdr in self.sdrs.items()},
        }

    async def _heartbeat_loop(self, interval: int):
        try:
            while True:
                if self.mqtt:
                    self.mqtt.publish_heartbeat(self.fleet_status())
                await asyncio.sleep(interval)
        except asyncio.CancelledError:
            pass

    async def _ws_bridge(self, sdr: SdrInstance):
        """Connect to an SDR backend's WebSocket and bridge data to MQTT."""
        try:
            import websockets
        except ImportError:
            logger.warning("websockets not installed — WS bridge disabled")
            return

        cfg = sdr.config
        # Determine the WebSocket port for this SDR
        if sdr.mode == "adsb":
            ws_port = cfg.get("port", 8771 + sdr.device_index)
        elif sdr.mode == "radio":
            ws_port = cfg.get("port", 8770)
        elif sdr.mode == "scanner":
            ws_port = cfg.get("ws_port", 8765)
        else:
            return

        ws_url = f"ws://127.0.0.1:{ws_port}"
        retry_delay = 2

        while True:
            try:
                async with websockets.connect(ws_url) as ws:
                    logger.info("WS bridge connected: SDR %d (%s) @ %s",
                                sdr.device_index, sdr.mode, ws_url)
                    retry_delay = 2

                    async for raw_msg in ws:
                        if not self.mqtt:
                            continue
                        try:
                            data = json.loads(raw_msg)
                            msg_type = data.get("type", "unknown")

                            # Add SDR metadata
                            data["sdr_index"] = sdr.device_index
                            data["sdr_label"] = sdr.label
                            data["node_id"] = self.node_id

                            self.mqtt.publish_sdr_data(
                                sdr.device_index, sdr.mode, msg_type, data
                            )
                        except (json.JSONDecodeError, Exception) as e:
                            logger.debug("WS bridge parse error (SDR %d): %s",
                                         sdr.device_index, e)

            except asyncio.CancelledError:
                return
            except Exception as e:
                if sdr.is_running():
                    logger.debug("WS bridge SDR %d reconnecting in %ds: %s",
                                 sdr.device_index, retry_delay, e)
                    await asyncio.sleep(retry_delay)
                    retry_delay = min(retry_delay * 2, 30)
                else:
                    # SDR stopped, wait until it's running again
                    await asyncio.sleep(5)
                    retry_delay = 2


# ── HTTP API ──

fleet: SdrFleetManager | None = None


async def handle_fleet_status(request: web.Request) -> web.Response:
    return web.json_response(fleet.fleet_status())


async def handle_sdr_status(request: web.Request) -> web.Response:
    idx = int(request.match_info["device"])
    sdr = fleet.sdrs.get(idx)
    if not sdr:
        return web.json_response({"error": f"No SDR at device {idx}"}, status=404)
    return web.json_response(sdr.status())


async def handle_sdr_start(request: web.Request) -> web.Response:
    idx = int(request.match_info["device"])
    result = await fleet.start_sdr(idx)
    return web.json_response(result, status=200 if result.get("ok") else 500)


async def handle_sdr_stop(request: web.Request) -> web.Response:
    idx = int(request.match_info["device"])
    result = await fleet.stop_sdr(idx)
    return web.json_response(result)


async def handle_sdr_reconfigure(request: web.Request) -> web.Response:
    idx = int(request.match_info["device"])
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)

    mode = body.get("mode")
    config = body.get("config", {})
    if not mode:
        return web.json_response({"ok": False, "error": "Missing 'mode'"}, status=400)

    result = await fleet.reconfigure_sdr(idx, mode, config)
    return web.json_response(result, status=200 if result.get("ok") else 500)


# Legacy single-SDR compat endpoints
async def handle_legacy_status(request: web.Request) -> web.Response:
    """Legacy GET /api/sdr — returns first running SDR's status."""
    for sdr in fleet.sdrs.values():
        if sdr.is_running():
            return web.json_response({
                "active_mode": sdr.mode,
                "pid": sdr.proc.pid if sdr.proc else None,
                "uptime_s": int(time.time() - sdr.started_at) if sdr.started_at else 0,
                "log": sdr.log[-40:],
            })
    return web.json_response({
        "active_mode": None, "pid": None, "uptime_s": 0, "log": [],
    })


async def handle_legacy_start(request: web.Request) -> web.Response:
    """Legacy POST /api/sdr/start — starts on first available device."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)

    mode = body.get("mode")
    config = body.get("config", {})
    device = config.get("device", 0)

    if mode not in ("radio", "scanner", "adsb"):
        return web.json_response({"ok": False, "error": f"Invalid mode: {mode}"}, status=400)

    sdr = fleet.sdrs.get(device)
    if not sdr:
        return web.json_response({"ok": False, "error": f"No SDR at device {device}"}, status=404)

    result = await fleet.reconfigure_sdr(device, mode, config)
    return web.json_response(result, status=200 if result.get("ok") else 500)


async def handle_legacy_stop(request: web.Request) -> web.Response:
    """Legacy POST /api/sdr/stop — stops all SDRs."""
    results = {}
    for idx, sdr in fleet.sdrs.items():
        if sdr.is_running():
            results[idx] = await sdr.stop()
    return web.json_response({"ok": True, "stopped": results})


# Aircraft log (same as sdr_agent.py)
import sqlite3
DB_PATH = SCRIPT_DIR / "db" / "aircraft.db"


async def handle_aircraft_log(request: web.Request) -> web.Response:
    try:
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row

        total = conn.execute("SELECT COUNT(*) FROM aircraft").fetchone()[0]
        today = time.strftime("%Y-%m-%d", time.gmtime())
        today_count = conn.execute(
            "SELECT COUNT(DISTINCT icao) FROM sightings WHERE ts >= ?",
            (today + "T00:00:00Z",),
        ).fetchone()[0]
        sighting_count = conn.execute("SELECT COUNT(*) FROM sightings").fetchone()[0]

        aircraft = []
        for row in conn.execute(
            "SELECT icao, callsign, first_seen, last_seen, total_msgs, sessions "
            "FROM aircraft ORDER BY last_seen DESC"
        ):
            aircraft.append(dict(row))

        positions = {}
        for row in conn.execute("""
            SELECT s.icao, s.lat, s.lon, s.alt_ft, s.gs_kt, s.hdg, s.ts
            FROM sightings s
            INNER JOIN (SELECT icao, MAX(id) as max_id FROM sightings GROUP BY icao) m
            ON s.icao = m.icao AND s.id = m.max_id
        """):
            positions[row["icao"]] = {
                "lat": row["lat"], "lon": row["lon"],
                "alt_ft": row["alt_ft"], "gs_kt": row["gs_kt"],
                "hdg": row["hdg"], "ts": row["ts"],
            }

        for ac in aircraft:
            ac["last_pos"] = positions.get(ac["icao"])

        conn.close()
        return web.json_response({
            "unique_aircraft": total, "today": today_count,
            "total_sightings": sighting_count, "aircraft": aircraft,
        })
    except Exception as e:
        return web.json_response({"error": str(e), "aircraft": []}, status=200)


def build_app() -> web.Application:
    app = web.Application()

    @web.middleware
    async def cors(request: web.Request, handler):
        if request.method == "OPTIONS":
            resp = web.Response()
        else:
            resp = await handler(request)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return resp

    app.middlewares.append(cors)

    # Fleet endpoints
    app.router.add_get("/api/fleet", handle_fleet_status)
    app.router.add_get("/api/fleet/{device}", handle_sdr_status)
    app.router.add_post("/api/fleet/{device}/start", handle_sdr_start)
    app.router.add_post("/api/fleet/{device}/stop", handle_sdr_stop)
    app.router.add_put("/api/fleet/{device}", handle_sdr_reconfigure)

    # Legacy single-SDR compat
    app.router.add_get("/api/sdr", handle_legacy_status)
    app.router.add_post("/api/sdr/start", handle_legacy_start)
    app.router.add_post("/api/sdr/stop", handle_legacy_stop)
    app.router.add_get("/api/adsb/log", handle_aircraft_log)

    return app


@click.command()
@click.option("--config", "config_path", default="fleet_config.yaml",
              help="Path to fleet config YAML")
@click.option("--port", type=int, default=8780, help="HTTP API port")
def main(config_path, port):
    """GROUNDLINK SDR Fleet Manager — Multi-SDR with MQTT."""
    global fleet

    cfg_path = Path(config_path)
    if not cfg_path.is_absolute():
        cfg_path = SCRIPT_DIR / cfg_path

    if cfg_path.exists():
        with open(cfg_path) as f:
            config = yaml.safe_load(f)
    else:
        logger.warning("Config not found: %s — using defaults", cfg_path)
        config = {"node_id": "default", "sdrs": []}

    fleet = SdrFleetManager(config)

    async def run():
        logger.info("=" * 60)
        logger.info("GROUNDLINK SDR Fleet Manager")
        logger.info("Node: %s", fleet.node_id)
        logger.info("SDRs: %d configured", len(fleet.sdrs))
        for idx, sdr in fleet.sdrs.items():
            logger.info("  SDR %d: %s (%s)", idx, sdr.label, sdr.mode)
        logger.info("HTTP API: http://0.0.0.0:%d", port)
        logger.info("=" * 60)

        # Start fleet
        await fleet.start_all()

        # Start HTTP server
        runner = web.AppRunner(build_app())
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", port)
        await site.start()

        try:
            await asyncio.Future()  # Run forever
        except (asyncio.CancelledError, KeyboardInterrupt):
            pass
        finally:
            await fleet.stop_all()
            await runner.cleanup()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        logger.info("Fleet shutting down")


if __name__ == "__main__":
    main()
