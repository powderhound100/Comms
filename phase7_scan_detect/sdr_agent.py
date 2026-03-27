"""GROUNDLINK SDR Agent — Host-side process manager.

Lightweight HTTP server that runs on the Windows host alongside the
RTL-SDR hardware.  The Docker-hosted Next.js dashboard calls this
agent to start/stop SDR backends (radio, scanner, ADS-B) without
needing to spawn processes inside the container.

Usage:
    python sdr_agent.py [--port 8780]

API:
    GET  /api/sdr          → { active_mode, pid, uptime_s, log }
    POST /api/sdr/start    → { mode: "radio"|"scanner"|"adsb", config: {...} }
    POST /api/sdr/stop     → {}
"""

import asyncio
import json
import logging
import os
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

from aiohttp import web

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("sdr-agent")

SCRIPT_DIR = Path(__file__).parent.resolve()
RTLSDR_DIR = r"D:\tools\rtl-sdr\x64"
MAX_LOG_LINES = 80


class SdrProcessManager:
    """Manages one SDR backend process at a time."""

    def __init__(self):
        self.proc: asyncio.subprocess.Process | None = None
        self.mode: str | None = None
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
            "active_mode": self.mode if self.is_running() else None,
            "pid": self.proc.pid if self.is_running() else None,
            "uptime_s": int(time.time() - self.started_at) if self.is_running() and self.started_at else 0,
            "log": self.log[-40:],
        }

    async def stop(self) -> dict:
        was_mode = self.mode
        if not self.is_running():
            self.proc = None
            self.mode = None
            self.started_at = None
            return {"ok": True, "stopped": was_mode}

        pid = self.proc.pid
        self._push_log(f"Stopping {was_mode} (PID {pid})...")

        # Cancel log reader tasks
        for t in self._log_tasks:
            t.cancel()
        self._log_tasks.clear()

        # Kill process tree on Windows
        try:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/PID", str(pid), "/T", "/F"],
                    capture_output=True, timeout=5,
                )
            else:
                self.proc.terminate()
        except Exception as e:
            self._push_log(f"Kill error: {e}")

        # Wait for exit
        try:
            await asyncio.wait_for(self.proc.wait(), timeout=3.0)
        except asyncio.TimeoutError:
            try:
                self.proc.kill()
                await self.proc.wait()
            except Exception:
                pass

        self._push_log(f"{was_mode} stopped.")
        self.proc = None
        self.mode = None
        self.started_at = None
        return {"ok": True, "stopped": was_mode}

    async def start(self, mode: str, config: dict) -> dict:
        # Stop current if running
        if self.is_running():
            if self.mode == mode:
                return {"ok": True, "message": f"{mode} already running", "pid": self.proc.pid}
            self._push_log(f"Switching from {self.mode} to {mode}...")
            await self.stop()
            # Let RTL-SDR device release
            await asyncio.sleep(0.8)

        self.log = []
        env = os.environ.copy()
        if RTLSDR_DIR not in env.get("PATH", ""):
            env["PATH"] = RTLSDR_DIR + ";" + env.get("PATH", "")

        cmd = self._build_command(mode, config)
        self._push_log(f"Starting {mode}: {' '.join(cmd)}")

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

        self.mode = mode
        self.started_at = time.time()

        # Background log readers
        self._log_tasks = [
            asyncio.create_task(self._read_stream(self.proc.stdout, "out")),
            asyncio.create_task(self._read_stream(self.proc.stderr, "log")),
            asyncio.create_task(self._watch_exit()),
        ]

        # Give it a moment to fail
        await asyncio.sleep(0.6)

        if self.is_running():
            return {"ok": True, "message": f"{mode} started", "pid": self.proc.pid}
        else:
            self.mode = None
            self.started_at = None
            return {"ok": False, "message": f"{mode} exited immediately — check log"}

    def _build_command(self, mode: str, config: dict) -> list[str]:
        if mode == "radio":
            return [
                sys.executable,
                str(SCRIPT_DIR / "radio_server.py"),
                "--port", str(config.get("port", 8770)),
                "--freq", str(config.get("freq", 94.9)),
                "--mode", config.get("mode", "wfm"),
            ]
        elif mode == "scanner":
            cmd = [sys.executable, str(SCRIPT_DIR / "scanner.py")]
            if config.get("mock"):
                cmd.append("--mock")
            if config.get("mode"):
                cmd.extend(["--mode", config["mode"]])
            if config.get("start_freq"):
                cmd.extend(["--start-freq", str(config["start_freq"])])
            if config.get("stop_freq"):
                cmd.extend(["--stop-freq", str(config["stop_freq"])])
            if config.get("watch_freq"):
                cmd.extend(["--watch-freq", str(config["watch_freq"])])
            return cmd
        elif mode == "adsb":
            cmd = [
                sys.executable,
                str(SCRIPT_DIR / "adsb_server.py"),
                "--port", str(config.get("port", 8771)),
                "--gain", str(config.get("gain", 496)),
                "--device", str(config.get("device", 0)),
            ]
            if config.get("test"):
                cmd.append("--test")
            return cmd
        else:
            raise ValueError(f"Unknown mode: {mode}")

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
            self.mode = None
            self.started_at = None
        except asyncio.CancelledError:
            pass


# ── HTTP handlers ──

manager = SdrProcessManager()


async def handle_status(request: web.Request) -> web.Response:
    return web.json_response(manager.status())


async def handle_start(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)

    mode = body.get("mode")
    if mode not in ("radio", "scanner", "adsb"):
        return web.json_response(
            {"ok": False, "error": f"Invalid mode: {mode}. Use: radio, scanner, adsb"},
            status=400,
        )

    config = body.get("config", {})
    result = await manager.start(mode, config)
    result.update(manager.status())
    return web.json_response(result, status=200 if result["ok"] else 500)


async def handle_stop(request: web.Request) -> web.Response:
    result = await manager.stop()
    result.update(manager.status())
    return web.json_response(result)


# ── Aircraft log endpoints ──

DB_PATH = SCRIPT_DIR / "db" / "aircraft.db"


def _get_db() -> "sqlite3.Connection":
    import sqlite3
    return sqlite3.connect(str(DB_PATH))


async def handle_aircraft_log(request: web.Request) -> web.Response:
    """Return aircraft log: unique aircraft + stats."""
    try:
        conn = _get_db()
        conn.row_factory = sqlite3.Row

        stats_row = conn.execute("SELECT COUNT(*) as total FROM aircraft").fetchone()
        total = stats_row["total"] if stats_row else 0

        today = time.strftime("%Y-%m-%d", time.gmtime())
        today_count = conn.execute(
            "SELECT COUNT(DISTINCT icao) FROM sightings WHERE ts >= ?",
            (today + "T00:00:00Z",),
        ).fetchone()[0]

        sighting_count = conn.execute("SELECT COUNT(*) FROM sightings").fetchone()[0]

        # All unique aircraft, most recent first
        aircraft = []
        for row in conn.execute(
            "SELECT icao, callsign, first_seen, last_seen, total_msgs, sessions "
            "FROM aircraft ORDER BY last_seen DESC"
        ):
            aircraft.append({
                "icao": row["icao"],
                "callsign": row["callsign"],
                "first_seen": row["first_seen"],
                "last_seen": row["last_seen"],
                "total_msgs": row["total_msgs"],
                "sessions": row["sessions"],
            })

        # Last known position for each aircraft (subquery)
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
            "unique_aircraft": total,
            "today": today_count,
            "total_sightings": sighting_count,
            "aircraft": aircraft,
        })
    except Exception as e:
        return web.json_response({"error": str(e), "aircraft": []}, status=200)


def _rdp_indices(points: list, epsilon: float) -> list:
    """Ramer-Douglas-Peucker simplification returning indices to keep.

    Uses an iterative stack to avoid Python recursion limits on long tracks.
    *points* is a list of (lat, lon) tuples; *epsilon* is the tolerance in
    degrees (~0.0001° ≈ 11 m).
    """
    n = len(points)
    if n <= 2:
        return list(range(n))

    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]

    while stack:
        start, end = stack.pop()
        if end - start < 2:
            continue

        # Line from points[start] to points[end]
        sx, sy = points[start]
        ex, ey = points[end]
        dx, dy = ex - sx, ey - sy
        line_len_sq = dx * dx + dy * dy

        max_dist = 0.0
        max_idx = start
        for i in range(start + 1, end):
            px, py = points[i]
            if line_len_sq == 0:
                d = (px - sx) ** 2 + (py - sy) ** 2
            else:
                t = ((px - sx) * dx + (py - sy) * dy) / line_len_sq
                t = max(0.0, min(1.0, t))
                proj_x = sx + t * dx
                proj_y = sy + t * dy
                d = (px - proj_x) ** 2 + (py - proj_y) ** 2
            if d > max_dist:
                max_dist = d
                max_idx = i

        if max_dist > epsilon * epsilon:  # compare squared to avoid sqrt
            keep[max_idx] = True
            stack.append((start, max_idx))
            stack.append((max_idx, end))

    return [i for i, k in enumerate(keep) if k]


async def handle_aircraft_track(request: web.Request) -> web.Response:
    """Return flight path sightings for a single aircraft (downsampled to 500 max)."""
    icao = request.match_info["icao"].upper()
    try:
        conn = _get_db()
        conn.row_factory = sqlite3.Row

        # Fetch all sightings with position, ordered by time
        rows = conn.execute(
            "SELECT lat, lon, alt_ft, gs_kt, hdg, ts FROM sightings "
            "WHERE icao = ? AND lat IS NOT NULL AND lon IS NOT NULL ORDER BY ts ASC",
            (icao,),
        ).fetchall()

        total_points = len(rows)

        # Downsample to 500 max using RDP shape-preserving simplification
        if total_points > 500:
            points = [(r["lat"], r["lon"]) for r in rows]
            epsilon = 0.0001  # ~11 m
            indices = _rdp_indices(points, epsilon)
            while len(indices) > 500:
                epsilon *= 2
                indices = _rdp_indices(points, epsilon)
            rows = [rows[i] for i in indices]

        sightings = [
            {
                "lat": r["lat"], "lon": r["lon"], "alt_ft": r["alt_ft"],
                "gs_kt": r["gs_kt"], "hdg": r["hdg"], "ts": r["ts"],
            }
            for r in rows
        ]

        # Fetch aircraft master record
        ac_row = conn.execute(
            "SELECT icao, callsign, first_seen, last_seen, total_msgs, sessions "
            "FROM aircraft WHERE icao = ?",
            (icao,),
        ).fetchone()

        aircraft = None
        if ac_row:
            aircraft = {
                "icao": ac_row["icao"], "callsign": ac_row["callsign"],
                "first_seen": ac_row["first_seen"], "last_seen": ac_row["last_seen"],
                "total_msgs": ac_row["total_msgs"], "sessions": ac_row["sessions"],
            }

        conn.close()

        return web.json_response({
            "icao": icao,
            "aircraft": aircraft,
            "sightings": sightings,
            "total_points": total_points,
        })
    except Exception as e:
        return web.json_response(
            {"icao": icao, "aircraft": None, "sightings": [], "total_points": 0, "error": str(e)},
            status=200,
        )


def build_app() -> web.Application:
    app = web.Application()
    # CORS middleware for Docker → host requests
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
    app.router.add_get("/api/sdr", handle_status)
    app.router.add_post("/api/sdr/start", handle_start)
    app.router.add_post("/api/sdr/stop", handle_stop)
    app.router.add_get("/api/adsb/log", handle_aircraft_log)
    app.router.add_get("/api/adsb/track/{icao}", handle_aircraft_track)
    return app


def main():
    import argparse
    parser = argparse.ArgumentParser(description="GROUNDLINK SDR Agent")
    parser.add_argument("--port", type=int, default=8780, help="HTTP port (default: 8780)")
    args = parser.parse_args()

    logger.info("=" * 50)
    logger.info("GROUNDLINK SDR Agent")
    logger.info("Listening on http://0.0.0.0:%d", args.port)
    logger.info("Manages: radio_server.py, scanner.py, adsb_server.py")
    logger.info("=" * 50)

    web.run_app(build_app(), host="0.0.0.0", port=args.port, print=None)


if __name__ == "__main__":
    main()
