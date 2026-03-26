"""IQ sample preprocessing and normalization."""

import numpy as np


def normalize_iq(X: np.ndarray) -> np.ndarray:
    """Normalize each IQ sample to zero mean, unit variance per example.

    Args:
        X: shape (N, 2, 128) — raw IQ samples

    Returns:
        Normalized X with same shape
    """
    mean = X.mean(axis=(1, 2), keepdims=True)
    std = X.std(axis=(1, 2), keepdims=True)
    std = np.where(std == 0, 1.0, std)  # avoid division by zero
    return ((X - mean) / std).astype(np.float32)


def amplitude_normalize(X: np.ndarray) -> np.ndarray:
    """Scale each sample so max absolute value is 1.

    Args:
        X: shape (N, 2, 128)

    Returns:
        Amplitude-normalized X
    """
    max_val = np.abs(X).max(axis=(1, 2), keepdims=True)
    max_val = np.where(max_val == 0, 1.0, max_val)
    return (X / max_val).astype(np.float32)
