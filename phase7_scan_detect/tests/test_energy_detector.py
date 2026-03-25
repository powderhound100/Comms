"""Tests for the energy detector module."""

import numpy as np
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.energy_detector import EnergyDetector, DetectorConfig


@pytest.fixture
def detector():
    return EnergyDetector(DetectorConfig(threshold_db=10.0, min_bandwidth_hz=5000))


def test_compute_psd_shape(detector):
    """PSD output should match FFT size."""
    iq = np.random.randn(262144) + 1j * np.random.randn(262144)
    iq = iq.astype(np.complex64)
    freqs, psd = detector.compute_psd(iq, sample_rate=2_400_000)
    assert len(freqs) == len(psd)
    assert len(freqs) == detector.config.fft_size


def test_detect_with_signal(detector):
    """Should detect an injected signal above noise."""
    sample_rate = 2_400_000
    n = 262144
    t = np.arange(n) / sample_rate

    # Noise
    iq = (np.random.randn(n) + 1j * np.random.randn(n)).astype(np.complex64) * 0.01

    # Inject strong carrier at +200 kHz offset
    iq += 0.5 * np.exp(1j * 2 * np.pi * 200_000 * t).astype(np.complex64)

    freqs, psd = detector.compute_psd(iq, sample_rate)
    detections = detector.detect(psd, freqs, center_freq_hz=100_000_000)

    assert len(detections) >= 1
    # The detection should be near 100.2 MHz
    closest = min(detections, key=lambda d: abs(d.center_freq_hz - 100_200_000))
    assert abs(closest.center_freq_hz - 100_200_000) < 50_000  # within 50 kHz
    assert closest.snr_db > 10


def test_detect_noise_only(detector):
    """Pure noise should produce no detections with a reasonable threshold."""
    iq = (np.random.randn(262144) + 1j * np.random.randn(262144)).astype(np.complex64) * 0.01
    freqs, psd = detector.compute_psd(iq, sample_rate=2_400_000)
    detections = detector.detect(psd, freqs, center_freq_hz=100_000_000)
    # Should have very few or no detections in pure noise
    assert len(detections) <= 2


def test_noise_floor_estimate(detector):
    """Noise floor should be a reasonable value."""
    psd = np.random.randn(1024) * 5 - 60  # noise around -60 dBFS
    floor = detector._estimate_noise_floor(psd)
    assert -70 < floor < -50


def test_contiguous_regions(detector):
    """Should find contiguous True regions."""
    mask = np.array([False, True, True, True, False, True, True, False])
    regions = detector._find_contiguous_regions(mask)
    assert regions == [(1, 3), (5, 6)]


def test_cfar_threshold(detector):
    """CFAR threshold should be finite for interior bins."""
    detector.config.cfar_enabled = True
    psd = np.random.randn(1024) * 5 - 60
    threshold = detector._cfar_threshold(psd)
    # Edge bins should be inf, interior should be finite
    assert np.isinf(threshold[0])
    mid = len(psd) // 2
    assert np.isfinite(threshold[mid])
