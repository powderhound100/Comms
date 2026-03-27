"""GROUNDLINK Scanner — FFT-based energy detection with WebSocket streaming (Pi).

Lightweight scanner for Raspberry Pi 4B. No ML classification — just fast
FFT-based energy detection, spectrum streaming, and SQLite logging.
Classification can run on the Windows host if needed.

Architecture:
  - pyrtlsdr for SDR access (uses system librtlsdr-dev)
  - numpy FFT for spectrum analysis
  - Energy threshold detection (fixed + noise-adaptive)
  - WebSocket server for real-time spectrum + detection streaming
  - aiohttp REST API for control (start/stop/status/detections)
  - SQLite for detection logging

Modes:
  - sweep: scan a frequency range in steps
  - watch: dwell on a single frequency
  - band_list: scan specific band ranges

Usage:
    python scanner_server.py [--ws-port 8765] [--http-port 8766]
    python scanner_server.py --device-serial GROUNDLINK_RADIO --mode sweep
"""

import asyncio
import json
import logging
import os
import sqlite3
import struct
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import numpy as np
import click

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("scanner")

SCRIPT_DIR = Path(__file__).parent.resolve()
DB_DIR = SCRIPT_DIR.parent / "db"

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ScanConfig:
    mode: str = "sweep"                 # sweep | watch | band_list
    start_freq_hz: int = 24_000_000     # 24 MHz
    stop_freq_hz: int = 1_766_000_000   # 1766 MHz
    watch_freq_hz: int = 462_000_000    # default watch freq
    sample_rate: int = 2_400_000
    gain: int = 40                      # integer dB (pyrtlsdr)
    fft_size: int = 1024
    threshold_db: float = 10.0          # above noise floor
    dwell_time_ms: int = 100
    samples_per_step: int = 262_144
    bands: list = field(default_factory=list)


@dataclass
class Detection:
    freq_hz: float
    bandwidth_hz: float
    power_db: float
    snr_db: float
    timestamp: float
    scan_id: str = ""


# ---------------------------------------------------------------------------
# SQLite logger
# ---------------------------------------------------------------------------

class ScanLogger:
    """Minimal SQLite logger for detections."""

    def __init__(self, db_path: str):
        os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS scans (
                scan_id TEXT PRIMARY KEY,
                started_at REAL,
                stopped_at REAL,
                mode TEXT,
                start_freq_hz INTEGER,
                stop_freq_hz INTEGER
            );
            CREATE TABLE IF NOT EXISTS detections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id TEXT,
                timestamp REAL,
                freq_hz REAL,
                bandwidth_hz REAL,
                power_db REAL,
                snr_db REAL,
                FOREIGN KEY (scan_id) REFERENCES scans(scan_id)
            );
            CREATE INDEX IF NOT EXISTS idx_det_scan ON detections(scan_id);
            CREATE INDEX IF NOT EXISTS idx_det_freq ON detections(freq_hz);
        """)
        self.conn.commit()

    def start_scan(self, scan_id: str, mode: str, start_freq: int, stop_freq: int):
        self.conn.execute(
            "INSERT INTO scans (scan_id, started_at, mode, start_freq_hz, stop_freq_hz) "
            "VALUES (?, ?, ?, ?, ?)",
            (scan_id, time.time(), mode, start_freq, stop_freq),
        )
        self.conn.commit()

    def stop_scan(self, scan_id: str):
        self.conn.execute(
            "UPDATE scans SET stopped_at = ? WHERE scan_id = ?",
            (time.time(), scan_id),
        )
        self.conn.commit()

    def log_detection(self, det: Detection):
        self.conn.execute(
            "INSERT INTO detections (scan_id, timestamp, freq_hz, bandwidth_hz, power_db, snr_db) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (det.scan_id, det.timestamp, det.freq_hz, det.bandwidth_hz,
             det.power_db, det.snr_db),
        )
        self.conn.commit()

    def query_detections(self, scan_id=None, min_freq=None, max_freq=None,
                         limit=100, offset=0) -> list[dict]:
        sql = "SELECT * FROM detections WHERE 1=1"
        params = []
        if scan_id:
            sql += " AND scan_id = ?"
            params.append(scan_id)
        if min_freq is not None:
            sql += " AND freq_hz >= ?"
            params.append(min_freq)
        if max_freq is not None:
            sql += " AND freq_hz <= ?"
            params.append(max_freq)
        sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = self.conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def get_scan_sessions(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM scans ORDER BY started_at DESC LIMIT 50"
        ).fetchall()
        return [dict(r) for r in rows]

    def close(self):
        self.conn.close()


# ---------------------------------------------------------------------------
# Energy detector (inline, no external imports)
# ---------------------------------------------------------------------------

class EnergyDetector:
    """FFT-based energy detection with adaptive noise floor."""

    def __init__(self, fft_size: int = 1024, threshold_db: float = 10.0):
        self.fft_size = fft_size
        self.threshold_db = threshold_db
        self.noise_floor_db: float | None = None
        self._alpha = 0.1  # noise floor EMA smoothing

    def compute_psd(self, iq_samples: np.ndarray) -> np.ndarray:
        """Compute power spectral density in dBFS from IQ samples."""
        n = self.fft_size
        num_segments = max(1, len(iq_samples) // n)
        psd_acc = np.zeros(n, dtype=np.float64)

        for i in range(num_segments):
            segment = iq_samples[i * n : (i + 1) * n]
            if len(segment) < n:
                break
            # Apply Hann window
            windowed = segment * np.hanning(n)
            # FFT and shift
            spectrum = np.fft.fftshift(np.fft.fft(windowed, n))
            # Power in dB (avoid log of zero)
            power = np.abs(spectrum) ** 2 / (n * n)
            psd_acc += power

        psd_avg = psd_acc / max(num_segments, 1)
        psd_db = 10.0 * np.log10(np.maximum(psd_avg, 1e-20))
        return psd_db.astype(np.float32)

    def detect(self, psd_db: np.ndarray, center_freq_hz: int,
               sample_rate: int) -> list[Detection]:
        """Find signals above the noise floor + threshold."""
        # Estimate noise floor as median of PSD
        noise_floor = float(np.median(psd_db))
        if self.noise_floor_db is None:
            self.noise_floor_db = noise_floor
        else:
            self.noise_floor_db = (1 - self._alpha) * self.noise_floor_db + self._alpha * noise_floor

        threshold = self.noise_floor_db + self.threshold_db

        # Find bins above threshold
        above = psd_db > threshold
        if not np.any(above):
            return []

        # Group contiguous bins into detections
        detections = []
        freq_per_bin = sample_rate / len(psd_db)
        start_freq = center_freq_hz - sample_rate / 2

        in_detection = False
        det_start = 0
        det_power_sum = 0.0
        det_peak_power = -999.0

        for i in range(len(above)):
            if above[i] and not in_detection:
                in_detection = True
                det_start = i
                det_power_sum = 10 ** (psd_db[i] / 10)
                det_peak_power = psd_db[i]
            elif above[i] and in_detection:
                det_power_sum += 10 ** (psd_db[i] / 10)
                det_peak_power = max(det_peak_power, psd_db[i])
            elif not above[i] and in_detection:
                in_detection = False
                det_end = i
                bw_bins = det_end - det_start
                # Minimum 3 bins to count as a detection (filter single-bin spikes)
                if bw_bins >= 3:
                    center_bin = (det_start + det_end) / 2
                    det_freq = start_freq + center_bin * freq_per_bin
                    det_bw = bw_bins * freq_per_bin
                    det_power = 10 * np.log10(det_power_sum / bw_bins)
                    det_snr = det_peak_power - self.noise_floor_db

                    detections.append(Detection(
                        freq_hz=det_freq,
                        bandwidth_hz=det_bw,
                        power_db=det_power,
                        snr_db=det_snr,
                        timestamp=time.time(),
                    ))

        # Close trailing detection
        if in_detection:
            det_end = len(above)
            bw_bins = det_end - det_start
            if bw_bins >= 3:
                center_bin = (det_start + det_end) / 2
                det_freq = start_freq + center_bin * freq_per_bin
                det_bw = bw_bins * freq_per_bin
                det_power = 10 * np.log10(det_power_sum / bw_bins)
                det_snr = det_peak_power - self.noise_floor_db

                detections.append(Detection(
                    freq_hz=det_freq,
                    bandwidth_hz=det_bw,
                    power_db=det_power,
                    snr_db=det_snr,
                    timestamp=time.time(),
                ))

        return detections


# ---------------------------------------------------------------------------
# Scanner engine
# ---------------------------------------------------------------------------

class SpectrumScanner:
    """FFT-based spectrum scanner with sweep/watch/band_list modes."""

    def __init__(self, config: ScanConfig, device_serial: str | None = None):
        self.config = config
        self.device_serial = device_serial
        self.sdr = None
        self.detector = EnergyDetector(
            fft_size=config.fft_size,
            threshold_db=config.threshold_db,
        )
        self.scan_id: str = ""
        self.is_running: bool = False
        self.current_freq: int = 0
        self.total_detections: int = 0

        # WebSocket clients
        self._ws_clients: set = set()

        # Recent detections (ring buffer for API)
        self._recent_detections: list[Detection] = []
        self._max_recent = 200

    def open_sdr(self):
        """Open RTL-SDR device via pyrtlsdr."""
        from rtlsdr import RtlSdr

        if self.device_serial:
            idx = RtlSdr.get_device_index_by_serial(self.device_serial)
            self.sdr = RtlSdr(idx)
            logger.info("Opened SDR device serial=%s (index=%d)", self.device_serial, idx)
        else:
            self.sdr = RtlSdr(0)
            logger.info("Opened SDR device index=0")

        self.sdr.sample_rate = self.config.sample_rate
        self.sdr.gain = self.config.gain
        self.sdr.freq_correction = 0

    def close_sdr(self):
        """Close the SDR device."""
        if self.sdr:
            try:
                self.sdr.close()
            except Exception:
                pass
            self.sdr = None

    async def start(self, scan_logger: ScanLogger | None = None):
        """Run the scan loop."""
        self.scan_id = str(uuid.uuid4())[:8]
        self.is_running = True
        self.total_detections = 0

        if scan_logger:
            scan_logger.start_scan(
                self.scan_id, self.config.mode,
                self.config.start_freq_hz, self.config.stop_freq_hz,
            )

        logger.info("Scan started [%s] mode=%s", self.scan_id, self.config.mode)

        try:
            if self.config.mode == "sweep":
                await self._sweep(scan_logger)
            elif self.config.mode == "watch":
                await self._watch(scan_logger)
            elif self.config.mode == "band_list":
                await self._band_list(scan_logger)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Scan error: %s", e, exc_info=True)
        finally:
            self.is_running = False
            if scan_logger:
                scan_logger.stop_scan(self.scan_id)
            logger.info("Scan stopped [%s] detections=%d", self.scan_id, self.total_detections)

    async def stop(self):
        """Signal the scan to stop."""
        self.is_running = False

    async def _sweep(self, scan_logger: ScanLogger | None):
        """Sweep from start to stop freq in sample_rate-wide steps."""
        step = self.config.sample_rate
        while self.is_running:
            freq = self.config.start_freq_hz
            while freq < self.config.stop_freq_hz and self.is_running:
                await self._scan_step(freq, scan_logger)
                freq += step
            # One full sweep done — loop back

    async def _watch(self, scan_logger: ScanLogger | None):
        """Dwell on a single frequency."""
        while self.is_running:
            await self._scan_step(self.config.watch_freq_hz, scan_logger)

    async def _band_list(self, scan_logger: ScanLogger | None):
        """Scan specific band ranges."""
        step = self.config.sample_rate
        while self.is_running:
            for band in self.config.bands:
                start = int(band.get("start_mhz", 24) * 1e6)
                stop = int(band.get("stop_mhz", 1766) * 1e6)
                freq = start
                while freq < stop and self.is_running:
                    await self._scan_step(freq, scan_logger)
                    freq += step

    async def _scan_step(self, center_freq: int, scan_logger: ScanLogger | None):
        """Tune, capture, FFT, detect, broadcast."""
        self.current_freq = center_freq

        if self.sdr is None:
            await asyncio.sleep(0.1)
            return

        try:
            self.sdr.center_freq = center_freq
        except Exception as e:
            logger.warning("Tune error at %d Hz: %s", center_freq, e)
            await asyncio.sleep(0.05)
            return

        # Dwell
        dwell_sec = self.config.dwell_time_ms / 1000.0

        # Read IQ samples (blocking call wrapped for async)
        loop = asyncio.get_event_loop()
        try:
            iq = await loop.run_in_executor(
                None, self.sdr.read_samples, self.config.samples_per_step
            )
        except Exception as e:
            logger.warning("Read error: %s", e)
            await asyncio.sleep(0.05)
            return

        iq = np.array(iq, dtype=np.complex64)

        # Compute PSD
        psd_db = self.detector.compute_psd(iq)

        # Detect signals
        detections = self.detector.detect(psd_db, center_freq, self.config.sample_rate)

        # Log detections
        for det in detections:
            det.scan_id = self.scan_id
            self.total_detections += 1
            self._recent_detections.append(det)
            if len(self._recent_detections) > self._max_recent:
                self._recent_detections = self._recent_detections[-self._max_recent:]
            if scan_logger:
                try:
                    scan_logger.log_detection(det)
                except Exception as e:
                    logger.warning("DB log error: %s", e)

        # Broadcast spectrum + detections to WebSocket clients
        await self._broadcast(center_freq, psd_db, detections)

        # Dwell pacing — subtract processing time
        await asyncio.sleep(max(0, dwell_sec - 0.02))

    async def _broadcast(self, center_freq: int, psd_db: np.ndarray,
                         detections: list[Detection]):
        """Send spectrum and detections to all connected WebSocket clients."""
        if not self._ws_clients:
            return

        # Decimate spectrum for bandwidth (send every 4th bin)
        decimated = psd_db[::4].tolist()

        msg = json.dumps({
            "type": "spectrum",
            "center_freq_hz": center_freq,
            "bandwidth_hz": self.config.sample_rate,
            "psd_dbfs": decimated,
            "noise_floor_db": self.detector.noise_floor_db,
            "detections": [
                {
                    "freq_hz": d.freq_hz,
                    "bandwidth_hz": d.bandwidth_hz,
                    "power_db": round(d.power_db, 1),
                    "snr_db": round(d.snr_db, 1),
                }
                for d in detections
            ],
            "scan_id": self.scan_id,
        })

        stale = set()
        for ws in self._ws_clients:
            try:
                await ws.send(msg)
            except Exception:
                stale.add(ws)
        self._ws_clients -= stale

    def add_client(self, ws):
        self._ws_clients.add(ws)

    def remove_client(self, ws):
        self._ws_clients.discard(ws)


# ---------------------------------------------------------------------------
# WebSocket server
# ---------------------------------------------------------------------------

async def ws_handler(websocket, scanner: SpectrumScanner):
    """Handle a WebSocket client — stream spectrum data."""
    import websockets

    scanner.add_client(websocket)
    logger.info("WS client connected (%d total)", len(scanner._ws_clients))

    try:
        async for msg in websocket:
            # Clients can send control messages
            try:
                data = json.loads(msg)
                cmd = data.get("type", "")
                if cmd == "config":
                    # Live config update
                    if "threshold_db" in data:
                        scanner.detector.threshold_db = float(data["threshold_db"])
                    if "gain" in data and scanner.sdr:
                        scanner.sdr.gain = int(data["gain"])
                    logger.info("WS config update: %s", data)
            except (json.JSONDecodeError, ValueError):
                pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        scanner.remove_client(websocket)
        logger.info("WS client disconnected (%d remain)", len(scanner._ws_clients))


# ---------------------------------------------------------------------------
# HTTP REST API
# ---------------------------------------------------------------------------

async def run_http_api(scanner: SpectrumScanner, scan_logger: ScanLogger,
                       host: str, port: int):
    """Lightweight aiohttp REST API for scanner control."""
    try:
        from aiohttp import web
    except ImportError:
        logger.warning("aiohttp not installed — HTTP API disabled. "
                       "Install with: pip install aiohttp")
        return

    _scan_task: asyncio.Task | None = None

    async def handle_status(request):
        return web.json_response({
            "running": scanner.is_running,
            "scan_id": scanner.scan_id,
            "current_freq_hz": scanner.current_freq,
            "total_detections": scanner.total_detections,
            "noise_floor_db": scanner.detector.noise_floor_db,
            "mode": scanner.config.mode,
        })

    async def handle_start(request):
        nonlocal _scan_task

        if scanner.is_running:
            await scanner.stop()
            if _scan_task and not _scan_task.done():
                _scan_task.cancel()
                try:
                    await _scan_task
                except (asyncio.CancelledError, Exception):
                    pass

        # Reopen SDR if needed
        try:
            scanner.close_sdr()
            scanner.open_sdr()
        except Exception as e:
            return web.json_response({"error": f"SDR open failed: {e}"}, status=500)

        # Apply config from request body
        try:
            body = await request.json()
        except Exception:
            body = {}

        if body.get("mode"):
            scanner.config.mode = body["mode"]
        if body.get("start_freq_mhz"):
            scanner.config.start_freq_hz = int(float(body["start_freq_mhz"]) * 1e6)
        if body.get("stop_freq_mhz"):
            scanner.config.stop_freq_hz = int(float(body["stop_freq_mhz"]) * 1e6)
        if body.get("watch_freq_mhz"):
            scanner.config.watch_freq_hz = int(float(body["watch_freq_mhz"]) * 1e6)
            if scanner.config.mode == "watch":
                logger.info("Watch mode: %.3f MHz", float(body["watch_freq_mhz"]))
        if body.get("dwell_time_ms"):
            scanner.config.dwell_time_ms = int(body["dwell_time_ms"])
        if body.get("threshold_db"):
            scanner.detector.threshold_db = float(body["threshold_db"])
        if body.get("gain"):
            scanner.config.gain = int(body["gain"])
            if scanner.sdr:
                scanner.sdr.gain = scanner.config.gain
        if body.get("bands"):
            scanner.config.bands = [
                {"start_mhz": b["start_mhz"], "stop_mhz": b["stop_mhz"],
                 "name": b.get("name")}
                for b in body["bands"]
            ]
            scanner.config.mode = "band_list"

        _scan_task = asyncio.create_task(scanner.start(scan_logger))
        return web.json_response({"status": "starting", "scan_id": scanner.scan_id})

    async def handle_stop(request):
        nonlocal _scan_task
        if not scanner.is_running:
            return web.json_response({"status": "already_stopped"})
        await scanner.stop()
        if _scan_task and not _scan_task.done():
            _scan_task.cancel()
        return web.json_response({"status": "stopped"})

    async def handle_detections(request):
        params = request.query
        results = scan_logger.query_detections(
            scan_id=params.get("scan_id"),
            min_freq=float(params["min_freq"]) if "min_freq" in params else None,
            max_freq=float(params["max_freq"]) if "max_freq" in params else None,
            limit=int(params.get("limit", 100)),
            offset=int(params.get("offset", 0)),
        )
        return web.json_response({"detections": results, "count": len(results)})

    async def handle_scans(request):
        sessions = scan_logger.get_scan_sessions()
        return web.json_response({"scans": sessions})

    app = web.Application()
    app.router.add_get("/api/status", handle_status)
    app.router.add_post("/api/start", handle_start)
    app.router.add_post("/api/stop", handle_stop)
    app.router.add_get("/api/detections", handle_detections)
    app.router.add_get("/api/scans", handle_scans)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    logger.info("HTTP API listening on http://%s:%d", host, port)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

@click.command()
@click.option("--ws-port", default=8765, help="WebSocket port for spectrum streaming")
@click.option("--http-port", default=8766, help="HTTP API port")
@click.option("--mode", default="sweep", type=click.Choice(["sweep", "watch", "band_list"]),
              help="Scan mode")
@click.option("--start-freq", default=24.0, help="Start frequency (MHz)")
@click.option("--stop-freq", default=1766.0, help="Stop frequency (MHz)")
@click.option("--watch-freq", default=None, type=float, help="Watch mode frequency (MHz)")
@click.option("--gain", default=40, help="SDR gain (integer dB)")
@click.option("--threshold-db", default=10.0, help="Detection threshold above noise floor (dB)")
@click.option("--device-serial", default=None, help="RTL-SDR device serial (for multi-dongle)")
@click.option("--db-path", default=None, help="SQLite database path")
def main(ws_port, http_port, mode, start_freq, stop_freq, watch_freq,
         gain, threshold_db, device_serial, db_path):
    """GROUNDLINK Scanner — FFT-based energy detection (Pi)."""
    import websockets

    config = ScanConfig(
        mode=mode,
        start_freq_hz=int(start_freq * 1e6),
        stop_freq_hz=int(stop_freq * 1e6),
        gain=gain,
        threshold_db=threshold_db,
    )
    if watch_freq:
        config.watch_freq_hz = int(watch_freq * 1e6)
        config.mode = "watch"

    scanner = SpectrumScanner(config, device_serial=device_serial)

    # SQLite logger
    if db_path is None:
        db_path = str(DB_DIR / "scanner.db")
    scan_logger = ScanLogger(db_path)

    async def run():
        # Open SDR
        try:
            scanner.open_sdr()
        except Exception as e:
            logger.error("Failed to open SDR: %s", e)
            logger.error("Ensure librtlsdr-dev is installed and the dongle is connected")
            return

        # Start WebSocket server
        ws_server = await websockets.serve(
            lambda ws: ws_handler(ws, scanner),
            "0.0.0.0", ws_port,
        )

        # Start HTTP API
        await run_http_api(scanner, scan_logger, "0.0.0.0", http_port)

        logger.info("=" * 60)
        logger.info("GROUNDLINK Scanner (Pi)")
        logger.info("Mode: %s", config.mode)
        if config.mode == "watch":
            logger.info("Frequency: %.3f MHz", config.watch_freq_hz / 1e6)
        else:
            logger.info("Range: %.1f - %.1f MHz", start_freq, stop_freq)
        logger.info("Gain: %d dB | Threshold: %.1f dB", gain, threshold_db)
        logger.info("WebSocket: ws://0.0.0.0:%d", ws_port)
        logger.info("HTTP API:  http://0.0.0.0:%d", http_port)
        if device_serial:
            logger.info("Device serial: %s", device_serial)
        logger.info("=" * 60)

        # Start scanning
        scan_task = asyncio.create_task(scanner.start(scan_logger))

        try:
            await asyncio.Future()  # Run forever
        except (asyncio.CancelledError, KeyboardInterrupt):
            pass
        finally:
            await scanner.stop()
            scan_task.cancel()
            ws_server.close()
            await ws_server.wait_closed()
            scanner.close_sdr()
            scan_logger.close()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        logger.info("Scanner shutting down")


if __name__ == "__main__":
    main()
