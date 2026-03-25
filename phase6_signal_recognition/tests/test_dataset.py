"""Smoke tests for dataset loading and model forward pass."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
import numpy as np
import torch

from src.dataset import MODULATIONS, SNRS, RadioMLDataset
from src.preprocessing import normalize_iq, amplitude_normalize
from src.models import VTCNN2, ResNet1d


def test_modulations_count():
    assert len(MODULATIONS) == 11


def test_snrs_range():
    assert SNRS[0] == -20
    assert SNRS[-1] == 18
    assert len(SNRS) == 20


def test_radioml_dataset_wrapper():
    """Test PyTorch Dataset wrapper with synthetic data."""
    X = np.random.randn(100, 2, 128).astype(np.float32)
    y = np.random.randint(0, 11, size=100).astype(np.int64)
    snrs = np.random.choice(SNRS, size=100).astype(np.int32)

    ds = RadioMLDataset(X, y, snrs)
    assert len(ds) == 100

    sample, label, snr = ds[0]
    assert sample.shape == (2, 128)
    assert isinstance(label, torch.Tensor)


def test_normalize_iq():
    X = np.random.randn(10, 2, 128).astype(np.float32) * 5 + 3
    X_norm = normalize_iq(X)
    assert X_norm.shape == X.shape
    # Each sample should be roughly zero mean
    for i in range(len(X_norm)):
        assert abs(X_norm[i].mean()) < 0.01


def test_amplitude_normalize():
    X = np.random.randn(10, 2, 128).astype(np.float32) * 5
    X_norm = amplitude_normalize(X)
    for i in range(len(X_norm)):
        assert np.abs(X_norm[i]).max() <= 1.0 + 1e-6


def test_vtcnn2_forward():
    model = VTCNN2(num_classes=11)
    x = torch.randn(4, 2, 128)
    out = model(x)
    assert out.shape == (4, 11)


def test_resnet1d_forward():
    model = ResNet1d(num_classes=11)
    x = torch.randn(4, 2, 128)
    out = model(x)
    assert out.shape == (4, 11)
