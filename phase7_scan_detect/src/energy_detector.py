"""Energy-based signal detection from power spectral density data."""

import logging
import numpy as np
from dataclasses import dataclass
from scipy import signal as sp_signal

logger = logging.getLogger(__name__)


@dataclass
class Detection:
    """A detected signal region."""
    center_freq_hz: float
    bandwidth_hz: float
    snr_db: float
    noise_floor_dbfs: float
    peak_power_dbfs: float
    bin_start: int = 0
    bin_end: int = 0


@dataclass
class DetectorConfig:
    threshold_db: float = 10.0
    min_bandwidth_hz: float = 5000.0
    fft_size: int = 1024
    overlap: float = 0.5
    cfar_enabled: bool = False
    cfar_guard_cells: int = 4
    cfar_reference_cells: int = 16


class EnergyDetector:
    """Detect signals in a PSD by finding regions above the noise floor."""

    def __init__(self, config: DetectorConfig):
        self.config = config

    def compute_psd(
        self, iq_samples: np.ndarray, sample_rate: int
    ) -> tuple[np.ndarray, np.ndarray]:
        """Compute power spectral density from IQ samples.

        Returns:
            freqs: frequency axis in Hz (relative to center)
            psd_dbfs: power in dBFS per bin
        """
        freqs, psd = sp_signal.welch(
            iq_samples,
            fs=sample_rate,
            nperseg=self.config.fft_size,
            noverlap=int(self.config.fft_size * self.config.overlap),
            window="hann",
            return_onesided=False,
            detrend=False,
        )
        # fftshift so DC is centered
        freqs = np.fft.fftshift(freqs)
        psd = np.fft.fftshift(psd)

        # Convert to dBFS (avoid log of zero)
        psd_dbfs = 10.0 * np.log10(np.maximum(psd, 1e-20))

        return freqs, psd_dbfs

    def detect(
        self, psd_dbfs: np.ndarray, freqs: np.ndarray, center_freq_hz: float
    ) -> list[Detection]:
        """Find signal regions above the noise floor.

        Args:
            psd_dbfs: power spectral density in dBFS
            freqs: frequency axis in Hz (relative offsets)
            center_freq_hz: absolute center frequency of the capture

        Returns:
            List of Detection objects for each signal found
        """
        if self.config.cfar_enabled:
            threshold = self._cfar_threshold(psd_dbfs)
        else:
            noise_floor = self._estimate_noise_floor(psd_dbfs)
            threshold = np.full_like(psd_dbfs, noise_floor + self.config.threshold_db)

        noise_floor_scalar = self._estimate_noise_floor(psd_dbfs)
        mask = psd_dbfs > threshold
        regions = self._find_contiguous_regions(mask)

        freq_resolution = freqs[1] - freqs[0] if len(freqs) > 1 else 1.0
        detections = []

        for start, end in regions:
            bandwidth_hz = (end - start + 1) * freq_resolution
            if bandwidth_hz < self.config.min_bandwidth_hz:
                continue

            peak_idx = start + np.argmax(psd_dbfs[start:end + 1])
            peak_power = float(psd_dbfs[peak_idx])
            signal_center_offset = float(freqs[peak_idx])
            abs_freq = center_freq_hz + signal_center_offset

            detections.append(Detection(
                center_freq_hz=abs_freq,
                bandwidth_hz=abs(bandwidth_hz),
                snr_db=peak_power - noise_floor_scalar,
                noise_floor_dbfs=noise_floor_scalar,
                peak_power_dbfs=peak_power,
                bin_start=start,
                bin_end=end,
            ))

        return detections

    def _estimate_noise_floor(self, psd_dbfs: np.ndarray) -> float:
        """Robust noise floor estimate using median."""
        return float(np.median(psd_dbfs))

    def _cfar_threshold(self, psd_dbfs: np.ndarray) -> np.ndarray:
        """Cell-Averaging CFAR adaptive threshold."""
        n = len(psd_dbfs)
        guard = self.config.cfar_guard_cells
        ref = self.config.cfar_reference_cells
        threshold = np.full(n, np.inf)

        for i in range(guard + ref, n - guard - ref):
            left = psd_dbfs[i - guard - ref : i - guard]
            right = psd_dbfs[i + guard + 1 : i + guard + ref + 1]
            noise_est = np.mean(np.concatenate([left, right]))
            threshold[i] = noise_est + self.config.threshold_db

        return threshold

    def _find_contiguous_regions(
        self, mask: np.ndarray
    ) -> list[tuple[int, int]]:
        """Find start/end indices of contiguous True regions."""
        regions = []
        in_region = False
        start = 0

        for i, val in enumerate(mask):
            if val and not in_region:
                start = i
                in_region = True
            elif not val and in_region:
                regions.append((start, i - 1))
                in_region = False

        if in_region:
            regions.append((start, len(mask) - 1))

        return regions
