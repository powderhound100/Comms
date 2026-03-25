"""GROUNDLINK Phase 7 — Scan & Detect service entry point.

Launches the SDR scanner, WebSocket server, and HTTP API.
"""

import asyncio
import json
import logging
import sys
from pathlib import Path

import click
import yaml

from src.sdr_backend import SDRDevice, SDRConfig
from src.energy_detector import EnergyDetector, DetectorConfig
from src.classifier import SignalClassifier
from src.demodulator import Demodulator
from src.protocol_decoder import ProtocolDecoder
from src.logger import ScanLogger
from src.websocket_server import ScanWebSocketServer
from src.spectrum_scanner import SpectrumScanner, ScanConfig


def load_config(config_path: str) -> dict:
    """Load YAML configuration."""
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def build_components(cfg: dict, mock: bool = False):
    """Build all scanner components from config."""
    sdr_cfg = cfg.get("sdr", {})
    scan_cfg = cfg.get("scan", {})
    det_cfg = cfg.get("detection", {})
    cls_cfg = cfg.get("classification", {})
    dem_cfg = cfg.get("demodulation", {})
    ws_cfg = cfg.get("websocket", {})
    log_cfg = cfg.get("logging", {})

    # SDR
    sdr_config = SDRConfig(
        device_index=sdr_cfg.get("device_index", 0),
        sample_rate=sdr_cfg.get("sample_rate", 2_400_000),
        gain=sdr_cfg.get("gain", 40),
        freq_correction_ppm=sdr_cfg.get("freq_correction_ppm", 0),
        direct_sampling=sdr_cfg.get("direct_sampling", False),
    )
    sdr = SDRDevice(sdr_config, mock=mock)

    # Detector
    detector_config = DetectorConfig(
        threshold_db=det_cfg.get("threshold_db", 10.0),
        min_bandwidth_hz=det_cfg.get("min_bandwidth_hz", 5000),
        fft_size=det_cfg.get("fft_size", 1024),
        overlap=det_cfg.get("overlap", 0.5),
        cfar_enabled=det_cfg.get("cfar_enabled", False),
        cfar_guard_cells=det_cfg.get("cfar_guard_cells", 4),
        cfar_reference_cells=det_cfg.get("cfar_reference_cells", 16),
    )
    detector = EnergyDetector(detector_config)

    # Classifier
    classifier = None
    if cls_cfg.get("enabled", True):
        classifier = SignalClassifier(
            model_name=cls_cfg.get("model", "vtcnn2"),
            checkpoint_path=cls_cfg.get("checkpoint"),
            min_snr_db=cls_cfg.get("min_snr_db", 5.0),
            top_k=cls_cfg.get("top_k", 3),
        )

    # Demodulator
    demodulator = None
    if dem_cfg.get("enabled", True):
        demodulator = Demodulator(
            audio_output_dir=dem_cfg.get("audio_output_dir", "output/audio"),
            max_duration_sec=dem_cfg.get("max_duration_sec", 10.0),
        )

    # Protocol decoder (extracts usable data: aircraft positions, images, etc.)
    proto_cfg = cfg.get("protocol_decode", {})
    protocol_decoder = ProtocolDecoder(
        iq_output_dir=proto_cfg.get("iq_output_dir", "output/iq_captures"),
        satdump_output_dir=proto_cfg.get("satdump_output_dir", "output/satellite"),
        enable_satdump=proto_cfg.get("enable_satdump", True),
    )

    # Logger
    scan_logger = ScanLogger(db_path=log_cfg.get("db_path", "db/scanner.db"))

    # WebSocket server
    ws_server = ScanWebSocketServer(
        host=ws_cfg.get("host", "0.0.0.0"),
        port=ws_cfg.get("port", 8765),
        spectrum_decimation=ws_cfg.get("spectrum_decimation", 4),
    )

    # Scan config
    scan_config = ScanConfig(
        mode=scan_cfg.get("mode", "sweep"),
        start_freq_hz=int(scan_cfg.get("start_freq_mhz", 24) * 1e6),
        stop_freq_hz=int(scan_cfg.get("stop_freq_mhz", 1766) * 1e6),
        dwell_time_ms=scan_cfg.get("dwell_time_ms", 100),
        samples_per_step=scan_cfg.get("samples_per_step", 262144),
        bands=scan_cfg.get("bands"),
        classify_enabled=cls_cfg.get("enabled", True),
        min_classify_snr_db=cls_cfg.get("min_snr_db", 5.0),
        model_name=cls_cfg.get("model", "vtcnn2"),
        checkpoint_path=cls_cfg.get("checkpoint"),
        demod_enabled=dem_cfg.get("enabled", True),
        ws_port=ws_cfg.get("port", 8765),
        spectrum_decimation=ws_cfg.get("spectrum_decimation", 4),
    )

    # Scanner
    scanner = SpectrumScanner(
        config=scan_config,
        sdr=sdr,
        detector=detector,
        classifier=classifier,
        demodulator=demodulator,
        protocol_decoder=protocol_decoder,
        scan_logger=scan_logger,
        ws_server=ws_server,
    )

    return sdr, scanner, ws_server, scan_logger


async def run_http_api(scanner: SpectrumScanner, scan_logger: ScanLogger, host: str, port: int):
    """Run a lightweight HTTP API for scanner control."""
    try:
        from aiohttp import web
    except ImportError:
        logging.warning("aiohttp not installed — HTTP API disabled. Install with: pip install aiohttp")
        return

    async def handle_status(request):
        return web.json_response({
            "running": scanner.is_running,
            "scan_id": scanner.scan_id,
            "current_freq_hz": scanner.current_freq,
            "total_detections": scanner.total_detections,
        })

    async def handle_start(request):
        if scanner.is_running:
            return web.json_response({"error": "Already running"}, status=400)
        asyncio.create_task(scanner.start())
        return web.json_response({"status": "starting", "scan_id": scanner.scan_id})

    async def handle_stop(request):
        if not scanner.is_running:
            return web.json_response({"error": "Not running"}, status=400)
        await scanner.stop()
        return web.json_response({"status": "stopped"})

    async def handle_detections(request):
        params = request.query
        results = scan_logger.query_detections(
            scan_id=params.get("scan_id"),
            min_freq=float(params["min_freq"]) if "min_freq" in params else None,
            max_freq=float(params["max_freq"]) if "max_freq" in params else None,
            modulation=params.get("modulation"),
            limit=int(params.get("limit", 100)),
            offset=int(params.get("offset", 0)),
        )
        return web.json_response({"detections": results, "count": len(results)})

    async def handle_scans(request):
        sessions = scan_logger.get_scan_sessions()
        return web.json_response({"scans": sessions})

    async def handle_aircraft(request):
        """Return current tracked aircraft from ADS-B protocol decoder."""
        if scanner.protocol_decoder:
            from dataclasses import asdict
            aircraft = {
                icao: asdict(ac)
                for icao, ac in scanner.protocol_decoder.tracked_aircraft.items()
            }
            return web.json_response({"aircraft": aircraft, "count": len(aircraft)})
        return web.json_response({"aircraft": {}, "count": 0})

    async def handle_satellite_jobs(request):
        """Return satellite decode job status."""
        if scanner.protocol_decoder:
            from dataclasses import asdict
            jobs = [asdict(j) for j in scanner.protocol_decoder.satellite_jobs]
            return web.json_response({"jobs": jobs, "count": len(jobs)})
        return web.json_response({"jobs": [], "count": 0})

    app = web.Application()
    app.router.add_get("/api/status", handle_status)
    app.router.add_post("/api/start", handle_start)
    app.router.add_post("/api/stop", handle_stop)
    app.router.add_get("/api/detections", handle_detections)
    app.router.add_get("/api/scans", handle_scans)
    app.router.add_get("/api/aircraft", handle_aircraft)
    app.router.add_get("/api/satellite-jobs", handle_satellite_jobs)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    logging.info("HTTP API listening on http://%s:%d", host, port)


@click.command()
@click.option("--config", "config_path", default="config.yaml", help="Path to config YAML")
@click.option("--mock", is_flag=True, default=False, help="Use mock SDR (no hardware required)")
@click.option("--mode", type=click.Choice(["sweep", "watch", "band_list"]), default=None, help="Override scan mode")
@click.option("--start-freq", type=float, default=None, help="Override start frequency (MHz)")
@click.option("--stop-freq", type=float, default=None, help="Override stop frequency (MHz)")
@click.option("--watch-freq", type=float, default=None, help="Watch mode frequency (MHz)")
def main(config_path, mock, mode, start_freq, stop_freq, watch_freq):
    """GROUNDLINK Scan & Detect — SDR signal scanner with AMR classification."""
    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    # Load config
    cfg_path = Path(config_path)
    if cfg_path.exists():
        cfg = load_config(str(cfg_path))
    else:
        logging.warning("Config file not found: %s — using defaults", config_path)
        cfg = {}

    # Build components
    sdr, scanner, ws_server, scan_logger = build_components(cfg, mock=mock)

    # Apply CLI overrides
    if mode:
        scanner.config.mode = mode
    if start_freq:
        scanner.config.start_freq_hz = int(start_freq * 1e6)
    if stop_freq:
        scanner.config.stop_freq_hz = int(stop_freq * 1e6)
    if watch_freq:
        scanner.config.watch_freq_hz = int(watch_freq * 1e6)
        scanner.config.mode = "watch"

    # Run
    async def run():
        sdr.open()
        await ws_server.start()

        http_cfg = cfg.get("http", {})
        await run_http_api(
            scanner, scan_logger,
            host=http_cfg.get("host", "0.0.0.0"),
            port=http_cfg.get("port", 8766),
        )

        logging.info("=" * 60)
        logging.info("GROUNDLINK Scan & Detect")
        logging.info("Mode: %s | Mock: %s", scanner.config.mode, mock)
        if scanner.config.mode == "watch":
            logging.info("Frequency: %.3f MHz", scanner.config.watch_freq_hz / 1e6)
        else:
            logging.info(
                "Range: %.1f - %.1f MHz",
                scanner.config.start_freq_hz / 1e6,
                scanner.config.stop_freq_hz / 1e6,
            )
        logging.info("=" * 60)

        try:
            await scanner.start()
        except KeyboardInterrupt:
            pass
        finally:
            await scanner.stop()
            await ws_server.stop()
            sdr.close()
            scan_logger.close()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        logging.info("Shutting down...")


if __name__ == "__main__":
    main()
