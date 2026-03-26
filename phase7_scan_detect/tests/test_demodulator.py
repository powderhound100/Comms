"""Tests for the demodulator module."""

import numpy as np
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.demodulator import Demodulator


@pytest.fixture
def demod():
    return Demodulator(audio_output_dir="output/audio", max_duration_sec=1.0)


def test_supported_types(demod):
    """Should support the main modulation types."""
    assert "WBFM" in demod.SUPPORTED
    assert "AM-DSB" in demod.SUPPORTED
    assert "BPSK" in demod.SUPPORTED
    assert "QPSK" in demod.SUPPORTED


def test_unsupported_returns_none(demod):
    """Unsupported modulation should return None."""
    iq = np.random.randn(10000).astype(np.complex64)
    result = demod.try_demod(iq, 0, 10000, 2_400_000, "QAM64")
    assert result is None


def test_none_modulation_returns_none(demod):
    """None modulation should return None."""
    iq = np.random.randn(10000).astype(np.complex64)
    result = demod.try_demod(iq, 0, 10000, 2_400_000, None)
    assert result is None


def test_demod_fm(demod):
    """FM demod should return audio samples."""
    sample_rate = 2_400_000
    n = 100000
    t = np.arange(n) / sample_rate

    # Generate FM signal
    mod_signal = np.sin(2 * np.pi * 1000 * t)
    phase = 2 * np.pi * 0 * t + 5000 * np.cumsum(mod_signal) / sample_rate
    iq = np.exp(1j * phase).astype(np.complex64)

    result = demod.try_demod(iq, 0, 200000, sample_rate, "WBFM")
    assert result is not None
    assert result.demod_type == "audio"
    assert result.samples is not None
    assert len(result.samples) > 0


def test_demod_am(demod):
    """AM demod should return audio samples."""
    sample_rate = 2_400_000
    n = 100000
    t = np.arange(n) / sample_rate

    # Generate AM signal
    carrier = np.exp(1j * 2 * np.pi * 0 * t)
    mod = 1.0 + 0.7 * np.sin(2 * np.pi * 400 * t)
    iq = (mod * carrier).astype(np.complex64)

    result = demod.try_demod(iq, 0, 25000, sample_rate, "AM-DSB")
    assert result is not None
    assert result.demod_type == "audio"
    assert result.samples is not None


def test_demod_bpsk(demod):
    """BPSK demod should return bit stream."""
    n = 10000
    iq = np.random.choice([-1.0, 1.0], size=n) + 0j
    iq = iq.astype(np.complex64)

    result = demod.try_demod(iq, 0, 10000, 2_400_000, "BPSK")
    assert result is not None
    assert result.demod_type == "bits"
    assert "BPSK" in result.preview
