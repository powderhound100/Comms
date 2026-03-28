"""GROUNDLINK Pi Agent — HTTP process supervisor for 3 independent SDR slots.

Manages SDR subprocesses, exposes REST API on port 8781, and provides
health monitoring for CPU temperature, throttling, and USB devices.
"""

import asyncio
import collections
import logging
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from aiohttp import web

# Config parsing — tomllib on 3.11+, tomli fallback
try:
    import tomllib
except ModuleNotFoundError:
    try:
        import tomli as tomllib
    except ModuleNotFoundError:
        print("ERROR: Install tomli (`pip install tomli`) on Python < 3.11")
        sys.exit(1)

logger = logging.getLogger("pi-agent")
BASE_DIR = Path(__file__).parent.resolve()
MAX_LOG_LINES = 200


# ---------------------------------------------------------------------------
# Health helpers
# ---------------------------------------------------------------------------

def read_cpu_temp() -> float | None:
    """Read CPU temperature from sysfs (Celsius)."""
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return int(f.read().strip()) / 1000.0
    except (FileNotFoundError, ValueError, OSError):
        return None


def read_throttle_status() -> dict:
    """Parse vcgencmd get_throttled output into human-readable flags."""
    flags = {
        0: "under-voltage",
        1: "arm-freq-capped",
        2: "currently-throttled",
        3: "soft-temp-limit",
        16: "under-voltage-occurred",
        17: "arm-freq-capped-occurred",
        18: "throttling-occurred",
        19: "soft-temp-limit-occurred",
    }
    try:
        out = subprocess.check_output(
            ["vcgencmd", "get_throttled"], timeout=5, text=True
        ).strip()
        # Output: throttled=0x50000
        hex_val = int(out.split("=")[1], 16)
        active = [desc for bit, desc in flags.items() if hex_val & (1 << bit)]
        return {"raw": hex(hex_val), "flags": active, "ok": hex_val == 0}
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
        return {"raw": None, "flags": [], "ok": None}


def count_usb_devices() -> int:
    """Count USB devices via /sys/bus/usb/devices."""
    try:
        return len(list(Path("/sys/bus/usb/devices").iterdir()))
    except (FileNotFoundError, OSError):
        return -1


# ---------------------------------------------------------------------------
# Slot Manager
# ---------------------------------------------------------------------------

class SlotManager:
    """Manages one SDR subprocess: start, stop, watchdog, log buffer."""

    def __init__(self, slot_id: int, config: dict, global_config: dict):
        self.slot_id = slot_id
        self.config = config
        self.global_config = global_config
        self.label = config.get("label", f"SDR {slot_id}")
        self.serial = config.get("serial")
        self.process: asyncio.subprocess.Process | None = None
        self.mode: str | None = None
        self.mode_config: dict = {}
        self.started_at: float | None = None
        self.restart_count = 0
        self.log_buffer: collections.deque = collections.deque(maxlen=MAX_LOG_LINES)
        self._watchdog_task: asyncio.Task | None = None
        self._log_tasks: list[asyncio.Task] = []

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.returncode is None

    def status(self) -> dict:
        return {
            "slot": self.slot_id,
            "label": self.label,
            "serial": self.serial,
            "mode": self.mode,
            "running": self.running,
            "pid": self.process.pid if self.process else None,
            "uptime_s": round(time.time() - self.started_at, 1) if self.started_at and self.running else None,
            "restart_count": self.restart_count,
            "log_lines": len(self.log_buffer),
        }

    def _build_command(self, mode: str, cfg: dict) -> list[str]:
        """Build the subprocess command for a given mode."""
        python = sys.executable
        win = self.global_config.get("windows", {})
        host = win.get("host", "192.168.1.100")
        serial = cfg.get("serial", self.serial)
        gain = cfg.get("gain", self.config.get("gain", 496))

        if mode == "adsb_1090":
            port = cfg.get("port", win.get("adsb_1090_port", 9001))
            cmd = [
                python, str(BASE_DIR / "streamers" / "adsb_streamer.py"),
                "--device-serial", serial,
                "--host", host,
                "--port", str(port),
                "--gain", str(gain),
            ]
        elif mode == "adsb_978":
            port = cfg.get("port", win.get("adsb_978_port", 9002))
            cmd = [
                python, str(BASE_DIR / "streamers" / "uat_streamer.py"),
                "--device-serial", serial,
                "--host", host,
                "--port", str(port),
                "--gain", str(gain),
            ]
        elif mode == "radio":
            freq = cfg.get("freq", self.config.get("default_freq", 154.8))
            radio_mode = cfg.get("radio_mode", self.config.get("default_radio_mode", "fm"))
            port = cfg.get("port", 8770)
            cmd = [
                python, str(BASE_DIR / "servers" / "radio_server.py"),
                "--port", str(port),
                "--freq", str(freq),
                "--mode", radio_mode,
                "--device-serial", serial,
            ]
        elif mode == "scanner":
            port = cfg.get("port", 8765)
            cmd = [
                python, str(BASE_DIR / "servers" / "scanner_server.py"),
                "--port", str(port),
                "--device-serial", serial,
            ]
            # Pass through any extra scanner options
            for key in ("freq_start", "freq_end", "step", "dwell"):
                if key in cfg:
                    cmd.extend([f"--{key.replace('_', '-')}", str(cfg[key])])
        else:
            raise ValueError(f"Unknown mode: {mode}")

        return cmd

    async def start(self, mode: str, cfg: dict | None = None):
        """Start the subprocess for the given mode."""
        if self.running:
            await self.stop()

        self.mode = mode
        self.mode_config = cfg or {}
        self.log_buffer.clear()

        cmd = self._build_command(mode, self.mode_config)
        self._log(f"Starting slot {self.slot_id} [{self.label}] mode={mode}")
        self._log(f"Command: {' '.join(cmd)}")

        try:
            self.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            self.started_at = time.time()
            self.restart_count = 0

            # Start log reader tasks
            self._log_tasks = [
                asyncio.create_task(self._read_stream(self.process.stdout, "OUT")),
                asyncio.create_task(self._read_stream(self.process.stderr, "ERR")),
            ]

            # Start watchdog
            if self._watchdog_task:
                self._watchdog_task.cancel()
            self._watchdog_task = asyncio.create_task(self._watchdog())

            logger.info("Slot %d started: pid=%d mode=%s", self.slot_id,
                        self.process.pid, mode)
        except Exception as e:
            self._log(f"Failed to start: {e}")
            logger.error("Slot %d start failed: %s", self.slot_id, e)
            raise

    async def stop(self):
        """Stop the subprocess gracefully, then force-kill after timeout."""
        if self._watchdog_task:
            self._watchdog_task.cancel()
            self._watchdog_task = None

        if self.process and self.process.returncode is None:
            self._log(f"Stopping slot {self.slot_id} (pid={self.process.pid})")
            try:
                self.process.terminate()
                try:
                    await asyncio.wait_for(self.process.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    self._log("Graceful shutdown timed out, killing")
                    self.process.kill()
                    await self.process.wait()
            except ProcessLookupError:
                pass

            logger.info("Slot %d stopped", self.slot_id)

        # Cancel log reader tasks
        for t in self._log_tasks:
            t.cancel()
        self._log_tasks.clear()

        self.process = None
        self.started_at = None
        self.mode = None

    async def _read_stream(self, stream: asyncio.StreamReader, prefix: str):
        """Read lines from a subprocess stream and buffer them."""
        try:
            while True:
                line = await stream.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").rstrip()
                self._log(f"[{prefix}] {text}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            self._log(f"Stream reader error: {e}")

    async def _watchdog(self):
        """Monitor subprocess, log exit, optionally restart."""
        try:
            while True:
                if self.process and self.process.returncode is not None:
                    rc = self.process.returncode
                    self._log(f"Process exited with code {rc}")
                    logger.warning("Slot %d exited (rc=%d)", self.slot_id, rc)
                    break
                await asyncio.sleep(2.0)
        except asyncio.CancelledError:
            return

    def _log(self, msg: str):
        """Append a timestamped message to the log buffer."""
        ts = time.strftime("%H:%M:%S")
        entry = f"{ts} {msg}"
        self.log_buffer.append(entry)
        logger.debug("Slot %d: %s", self.slot_id, msg)

    def get_log(self, lines: int = 80) -> list[str]:
        """Return the last N log lines."""
        buf = list(self.log_buffer)
        return buf[-lines:]


# ---------------------------------------------------------------------------
# CORS Middleware
# ---------------------------------------------------------------------------

def cors_middleware(app, handler):
    """Add CORS headers to all responses, handle preflight OPTIONS."""
    async def middleware(request):
        if request.method == "OPTIONS":
            resp = web.Response(status=204)
        else:
            try:
                resp = await handler(request)
            except web.HTTPException as e:
                resp = e

        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        resp.headers["Access-Control-Max-Age"] = "3600"
        return resp
    return middleware


# ---------------------------------------------------------------------------
# HTTP Handlers
# ---------------------------------------------------------------------------

class PiAgentApp:
    """aiohttp application with SDR slot management."""

    def __init__(self, config: dict):
        self.config = config
        self.slots: dict[int, SlotManager] = {}
        self.start_time = time.time()

        # Initialize 3 slot managers
        for i in range(3):
            slot_cfg = config.get("sdr", {}).get(str(i), {})
            self.slots[i] = SlotManager(i, slot_cfg, config)

    async def auto_start(self):
        """Auto-start slots marked auto_start=true in config."""
        for slot_id, slot in self.slots.items():
            cfg = self.config.get("sdr", {}).get(str(slot_id), {})
            if cfg.get("auto_start", False):
                mode = cfg.get("default_mode")
                if mode:
                    logger.info("Auto-starting slot %d in mode %s", slot_id, mode)
                    try:
                        await slot.start(mode, cfg)
                    except Exception as e:
                        logger.error("Auto-start slot %d failed: %s", slot_id, e)

    # --- Route handlers ---

    async def handle_status(self, request: web.Request) -> web.Response:
        """GET /api/pi/status — full status with all 3 slots."""
        data = {
            "agent": "groundlink-pi",
            "uptime_s": round(time.time() - self.start_time, 1),
            "slots": {str(i): slot.status() for i, slot in self.slots.items()},
            "health": self._health_data(),
        }
        return web.json_response(data)

    async def handle_health(self, request: web.Request) -> web.Response:
        """GET /api/pi/health — quick health check."""
        return web.json_response(self._health_data())

    async def handle_slot_start(self, request: web.Request) -> web.Response:
        """POST /api/pi/sdr/{slot}/start — start slot with mode + config."""
        slot_id = int(request.match_info["slot"])
        if slot_id not in self.slots:
            return web.json_response({"error": f"Invalid slot: {slot_id}"}, status=404)

        try:
            body = await request.json()
        except Exception:
            body = {}

        mode = body.get("mode")
        if not mode:
            # Fall back to default_mode from config
            slot_cfg = self.config.get("sdr", {}).get(str(slot_id), {})
            mode = slot_cfg.get("default_mode")
        if not mode:
            return web.json_response({"error": "No mode specified"}, status=400)

        try:
            await self.slots[slot_id].start(mode, body)
            return web.json_response({
                "ok": True,
                "slot": slot_id,
                "mode": mode,
                "pid": self.slots[slot_id].process.pid if self.slots[slot_id].process else None,
            })
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def handle_slot_stop(self, request: web.Request) -> web.Response:
        """POST /api/pi/sdr/{slot}/stop — stop slot."""
        slot_id = int(request.match_info["slot"])
        if slot_id not in self.slots:
            return web.json_response({"error": f"Invalid slot: {slot_id}"}, status=404)

        await self.slots[slot_id].stop()
        return web.json_response({"ok": True, "slot": slot_id, "stopped": True})

    async def handle_slot_log(self, request: web.Request) -> web.Response:
        """GET /api/pi/sdr/{slot}/log — last 80 lines of slot log."""
        slot_id = int(request.match_info["slot"])
        if slot_id not in self.slots:
            return web.json_response({"error": f"Invalid slot: {slot_id}"}, status=404)

        lines = int(request.query.get("lines", 80))
        return web.json_response({
            "slot": slot_id,
            "lines": self.slots[slot_id].get_log(lines),
        })

    # --- Internal helpers ---

    def _health_data(self) -> dict:
        """Gather system health info."""
        return {
            "cpu_temp_c": read_cpu_temp(),
            "throttle": read_throttle_status(),
            "usb_devices": count_usb_devices(),
            "slots_running": sum(1 for s in self.slots.values() if s.running),
        }

    def create_app(self) -> web.Application:
        """Build and return the aiohttp Application."""
        app = web.Application(middlewares=[cors_middleware])
        app.router.add_get("/api/pi/status", self.handle_status)
        app.router.add_get("/api/pi/health", self.handle_health)
        app.router.add_post("/api/pi/sdr/{slot}/start", self.handle_slot_start)
        app.router.add_post("/api/pi/sdr/{slot}/stop", self.handle_slot_stop)
        app.router.add_get("/api/pi/sdr/{slot}/log", self.handle_slot_log)

        app.on_startup.append(self._on_startup)
        app.on_shutdown.append(self._on_shutdown)
        return app

    async def _on_startup(self, app: web.Application):
        """Run auto-start after the server is up."""
        await self.auto_start()

    async def _on_shutdown(self, app: web.Application):
        """Stop all slots on shutdown."""
        logger.info("Shutting down — stopping all slots")
        for slot in self.slots.values():
            await slot.stop()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def load_config() -> dict:
    """Load config.toml from the same directory as this script."""
    config_path = BASE_DIR / "config.toml"
    if not config_path.exists():
        logger.warning("config.toml not found at %s, using defaults", config_path)
        return {"agent": {"port": 8781}, "windows": {"host": "192.168.1.100"}}

    with open(config_path, "rb") as f:
        return tomllib.load(f)


def main():
    """Start the Pi Agent HTTP server."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    config = load_config()
    agent_cfg = config.get("agent", {})
    port = agent_cfg.get("port", 8781)
    log_level = agent_cfg.get("log_level", "info").upper()
    logging.getLogger().setLevel(getattr(logging, log_level, logging.INFO))

    logger.info("GROUNDLINK Pi Agent starting on port %d", port)
    logger.info("Config: %s", BASE_DIR / "config.toml")

    agent = PiAgentApp(config)
    app = agent.create_app()
    web.run_app(app, host="0.0.0.0", port=port, print=logger.info)


if __name__ == "__main__":
    main()
