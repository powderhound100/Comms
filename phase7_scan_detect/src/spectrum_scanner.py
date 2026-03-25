"""Spectrum scanner — the core sweep loop that ties detection, classification, demod, and logging together."""

import asyncio
import logging
from datetime import datetime, timezone
from dataclasses import dataclass

import numpy as np

from .sdr_backend import SDRDevice, SDRConfig
from .energy_detector import EnergyDetector, DetectorConfig
from .classifier import SignalClassifier
from .demodulator import Demodulator
from .logger import ScanLogger, DetectionRecord
from .websocket_server import ScanWebSocketServer
from .known_signals import match_signal

logger = logging.getLogger(__name__)


@dataclass
class ScanConfig:
    # Frequency range
    mode: str = "sweep"  # sweep | watch | band_list
    start_freq_hz: int = 24_000_000
    stop_freq_hz: int = 1_766_000_000
    watch_freq_hz: int = 100_000_000  # for watch mode

    # Timing
    dwell_time_ms: int = 100
    samples_per_step: int = 262144

    # Band list mode
    bands: list[dict] | None = None

    # Classification
    classify_enabled: bool = True
    min_classify_snr_db: float = 5.0
    model_name: str = "vtcnn2"
    checkpoint_path: str | None = None

    # Demodulation
    demod_enabled: bool = True

    # SDR
    sdr: SDRConfig | None = None

    # WebSocket
    ws_port: int = 8765
    spectrum_decimation: int = 4


class SpectrumScanner:
    """Main scan loop: sweep frequencies, detect signals, classify, demod, log."""

    def __init__(
        self,
        config: ScanConfig,
        sdr: SDRDevice,
        detector: EnergyDetector,
        classifier: SignalClassifier | None,
        demodulator: Demodulator | None,
        scan_logger: ScanLogger,
        ws_server: ScanWebSocketServer,
    ):
        self.config = config
        self.sdr = sdr
        self.detector = detector
        self.classifier = classifier
        self.demodulator = demodulator
        self.scan_logger = scan_logger
        self.ws_server = ws_server

        self._running = False
        self._scan_id: str | None = None
        self._current_freq: int = 0
        self._total_detections: int = 0

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def scan_id(self) -> str | None:
        return self._scan_id

    @property
    def current_freq(self) -> int:
        return self._current_freq

    @property
    def total_detections(self) -> int:
        return self._total_detections

    async def start(self) -> None:
        """Start the scan loop."""
        if self._running:
            logger.warning("Scanner already running")
            return

        self._running = True
        config_dict = {
            "mode": self.config.mode,
            "start_freq_hz": self.config.start_freq_hz,
            "stop_freq_hz": self.config.stop_freq_hz,
            "model": self.config.model_name,
        }
        self._scan_id = self.scan_logger.start_scan(config_dict)
        self._total_detections = 0

        await self.ws_server.broadcast_status(
            "started",
            scan_id=self._scan_id,
            mode=self.config.mode,
        )

        logger.info(
            "Scan started: mode=%s, range=%.1f-%.1f MHz, scan_id=%s",
            self.config.mode,
            self.config.start_freq_hz / 1e6,
            self.config.stop_freq_hz / 1e6,
            self._scan_id,
        )

        try:
            await self._scan_loop()
        except asyncio.CancelledError:
            logger.info("Scan cancelled")
        except Exception as e:
            logger.error("Scan error: %s", e, exc_info=True)
        finally:
            await self.stop()

    async def stop(self) -> None:
        """Stop the scan loop."""
        if not self._running:
            return

        self._running = False
        if self._scan_id:
            self.scan_logger.stop_scan(self._scan_id)
            await self.ws_server.broadcast_status(
                "stopped",
                scan_id=self._scan_id,
                total_detections=self._total_detections,
            )
            logger.info(
                "Scan stopped: %d detections logged", self._total_detections
            )
            self._scan_id = None

    async def _scan_loop(self) -> None:
        """Main scanning loop."""
        sample_rate = self.sdr.config.sample_rate

        while self._running:
            for freq in self._frequency_steps():
                if not self._running:
                    break

                self._current_freq = freq
                self.sdr.set_center_freq(freq)

                # Capture IQ samples
                iq = self.sdr.read_samples(self.config.samples_per_step)

                # Compute PSD
                freqs, psd_dbfs = self.detector.compute_psd(iq, sample_rate)

                # Broadcast spectrum to dashboard
                await self.ws_server.broadcast_spectrum(
                    freq, psd_dbfs, sample_rate
                )

                # Detect signals
                detections = self.detector.detect(psd_dbfs, freqs, freq)

                for det in detections:
                    now = datetime.now(timezone.utc).isoformat()

                    # Classify
                    classification = None
                    if self.config.classify_enabled and self.classifier:
                        offset = det.center_freq_hz - freq
                        classification = self.classifier.classify(
                            iq, offset, det.bandwidth_hz, sample_rate, det.snr_db
                        )

                    # Demod
                    demod_result = None
                    mod_type = classification.modulation if classification else None
                    if self.config.demod_enabled and self.demodulator and mod_type:
                        offset = det.center_freq_hz - freq
                        demod_result = self.demodulator.try_demod(
                            iq, offset, det.bandwidth_hz, sample_rate, mod_type
                        )

                    # Match known signal
                    known = match_signal(det.center_freq_hz, mod_type)

                    # Build detection record
                    record = DetectionRecord(
                        scan_id=self._scan_id,
                        detected_at=now,
                        frequency_hz=det.center_freq_hz,
                        bandwidth_hz=det.bandwidth_hz,
                        snr_db=det.snr_db,
                        noise_floor_dbfs=det.noise_floor_dbfs,
                        peak_power_dbfs=det.peak_power_dbfs,
                        modulation=mod_type,
                        confidence=classification.confidence if classification else None,
                        model_used=self.config.model_name if classification else None,
                        inference_ms=classification.inference_ms if classification else None,
                        known_signal=known.name if known else None,
                        demod_type=demod_result.demod_type if demod_result else None,
                        demod_preview=demod_result.preview if demod_result else None,
                    )

                    # Log to database
                    self.scan_logger.log_detection(record)
                    self._total_detections += 1

                    # Broadcast detection to dashboard
                    await self.ws_server.broadcast_detection({
                        "frequency_hz": det.center_freq_hz,
                        "bandwidth_hz": det.bandwidth_hz,
                        "snr_db": det.snr_db,
                        "modulation": mod_type,
                        "confidence": classification.confidence if classification else None,
                        "top_k": classification.top_k if classification else None,
                        "known_signal": known.name if known else None,
                        "demod_type": demod_result.demod_type if demod_result else None,
                        "demod_preview": demod_result.preview if demod_result else None,
                    })

                    logger.info(
                        "Detection: %.3f MHz | %s (%.1f%%) | SNR %.1f dB | %s",
                        det.center_freq_hz / 1e6,
                        mod_type or "unknown",
                        (classification.confidence * 100) if classification else 0,
                        det.snr_db,
                        known.name if known else "unidentified",
                    )

                # Dwell time
                await asyncio.sleep(self.config.dwell_time_ms / 1000.0)

            # In watch mode, loop continuously on the same frequency
            if self.config.mode == "watch":
                continue

    def _frequency_steps(self) -> list[int]:
        """Generate list of center frequencies for the sweep."""
        sample_rate = self.sdr.config.sample_rate

        if self.config.mode == "watch":
            return [self.config.watch_freq_hz]

        if self.config.mode == "band_list" and self.config.bands:
            freqs = []
            for band in self.config.bands:
                if "center_mhz" in band:
                    freqs.append(int(band["center_mhz"] * 1e6))
                elif "start_mhz" in band and "stop_mhz" in band:
                    start = int(band["start_mhz"] * 1e6)
                    stop = int(band["stop_mhz"] * 1e6)
                    freq = start + sample_rate // 2
                    while freq < stop:
                        freqs.append(freq)
                        freq += sample_rate
            return freqs

        # Sweep mode: step through the full range
        freqs = []
        freq = self.config.start_freq_hz + sample_rate // 2
        while freq < self.config.stop_freq_hz:
            freqs.append(freq)
            freq += sample_rate

        return freqs
