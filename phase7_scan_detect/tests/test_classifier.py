"""Tests for the Phase 6 AMR classifier bridge."""

import numpy as np
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.classifier import SignalClassifier, MODULATIONS, MODEL_INPUT_LENGTH


@pytest.fixture
def classifier():
    """Create classifier — uses pre-trained weights if available."""
    return SignalClassifier(model_name="vtcnn2", min_snr_db=3.0, top_k=3)


def test_modulations_list():
    """Should have 11 modulation types from Phase 6."""
    assert len(MODULATIONS) == 11
    assert "BPSK" in MODULATIONS
    assert "WBFM" in MODULATIONS
    assert "QAM16" in MODULATIONS


def test_model_input_length():
    """Model expects 128 time steps."""
    assert MODEL_INPUT_LENGTH == 128


def test_classify_returns_result(classifier):
    """Classification should return a result for a valid signal."""
    sample_rate = 2_400_000
    n = 262144
    t = np.arange(n) / sample_rate

    # Generate a BPSK-like signal
    sps = 250  # samples per symbol
    num_symbols = (n + sps - 1) // sps
    bits = np.random.choice([-1, 1], size=num_symbols)
    modulated = np.repeat(bits, sps)[:n]
    carrier = np.exp(1j * 2 * np.pi * 100_000 * t)
    iq = (0.5 * modulated * carrier).astype(np.complex64)
    iq += (np.random.randn(n) + 1j * np.random.randn(n)).astype(np.complex64) * 0.01

    result = classifier.classify(
        iq,
        detection_offset_hz=100_000,
        detection_bandwidth_hz=20_000,
        sample_rate=sample_rate,
        snr_db=20.0,
    )

    assert result is not None
    assert result.modulation in MODULATIONS
    assert 0 <= result.confidence <= 1
    assert len(result.top_k) == 3
    assert result.inference_ms > 0


def test_classify_low_snr_returns_none(classifier):
    """Should return None when SNR is below threshold."""
    iq = np.zeros(262144, dtype=np.complex64)
    result = classifier.classify(iq, 0, 10000, 2_400_000, snr_db=1.0)
    assert result is None


def test_prepare_for_model(classifier):
    """Model input should be shape (1, 2, 128)."""
    segment = np.random.randn(256) + 1j * np.random.randn(256)
    segment = segment.astype(np.complex64)
    tensor = classifier._prepare_for_model(segment)
    assert tensor.shape == (1, 2, MODEL_INPUT_LENGTH)
