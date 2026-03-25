"""RadioML 2016.10a dataset loading and PyTorch Dataset wrapper."""

import pickle
import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader
from pathlib import Path
from sklearn.model_selection import train_test_split


# The 11 modulation classes in RadioML 2016.10a
MODULATIONS = [
    "8PSK", "AM-DSB", "AM-SSB", "BPSK", "CPFSK",
    "GFSK", "PAM4", "QAM16", "QAM64", "QPSK", "WBFM",
]

# SNR levels in the dataset: -20 to +18 dB in steps of 2
SNRS = list(range(-20, 20, 2))


def load_radioml_2016a(data_dir: str = "data") -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Load RadioML 2016.10a from pickle file.

    Returns:
        X: IQ samples, shape (N, 2, 128) — 2 channels (I, Q), 128 time steps
        y: integer labels, shape (N,)
        snrs: SNR values, shape (N,)
    """
    pkl_path = Path(data_dir) / "RML2016.10a_dict.pkl"
    if not pkl_path.exists():
        raise FileNotFoundError(
            f"Dataset not found at {pkl_path}. "
            "Run: python scripts/download_radioml.py"
        )

    with open(pkl_path, "rb") as f:
        data_dict = pickle.load(f, encoding="latin1")

    X_list, y_list, snr_list = [], [], []

    for (mod, snr), samples in data_dict.items():
        label = MODULATIONS.index(mod) if mod in MODULATIONS else -1
        if label == -1:
            continue
        X_list.append(samples)
        y_list.extend([label] * len(samples))
        snr_list.extend([snr] * len(samples))

    X = np.vstack(X_list).astype(np.float32)  # (N, 2, 128)
    y = np.array(y_list, dtype=np.int64)
    snrs = np.array(snr_list, dtype=np.int32)

    return X, y, snrs


def split_dataset(
    X: np.ndarray,
    y: np.ndarray,
    snrs: np.ndarray,
    test_size: float = 0.2,
    val_size: float = 0.2,
    seed: int = 42,
) -> dict:
    """Split into train/val/test sets, stratified by label.

    Returns dict with keys: X_train, y_train, snr_train, etc.
    """
    # First split: train+val vs test
    X_tv, X_test, y_tv, y_test, snr_tv, snr_test = train_test_split(
        X, y, snrs, test_size=test_size, random_state=seed, stratify=y
    )

    # Second split: train vs val (val_size is fraction of original, so adjust)
    val_fraction = val_size / (1.0 - test_size)
    X_train, X_val, y_train, y_val, snr_train, snr_val = train_test_split(
        X_tv, y_tv, snr_tv, test_size=val_fraction, random_state=seed, stratify=y_tv
    )

    return {
        "X_train": X_train, "y_train": y_train, "snr_train": snr_train,
        "X_val": X_val, "y_val": y_val, "snr_val": snr_val,
        "X_test": X_test, "y_test": y_test, "snr_test": snr_test,
    }


class RadioMLDataset(Dataset):
    """PyTorch Dataset wrapper for RadioML IQ data."""

    def __init__(self, X: np.ndarray, y: np.ndarray, snrs: np.ndarray | None = None):
        self.X = torch.from_numpy(X)
        self.y = torch.from_numpy(y)
        self.snrs = torch.from_numpy(snrs) if snrs is not None else None

    def __len__(self) -> int:
        return len(self.y)

    def __getitem__(self, idx: int):
        sample = self.X[idx]
        label = self.y[idx]
        if self.snrs is not None:
            return sample, label, self.snrs[idx]
        return sample, label


def get_dataloaders(
    data_dir: str = "data",
    batch_size: int = 256,
    seed: int = 42,
) -> tuple[DataLoader, DataLoader, DataLoader, dict]:
    """Load dataset and return train/val/test DataLoaders plus split data.

    Returns:
        train_loader, val_loader, test_loader, split_data
    """
    X, y, snrs = load_radioml_2016a(data_dir)
    splits = split_dataset(X, y, snrs, seed=seed)

    train_ds = RadioMLDataset(splits["X_train"], splits["y_train"], splits["snr_train"])
    val_ds = RadioMLDataset(splits["X_val"], splits["y_val"], splits["snr_val"])
    test_ds = RadioMLDataset(splits["X_test"], splits["y_test"], splits["snr_test"])

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False)
    test_loader = DataLoader(test_ds, batch_size=batch_size, shuffle=False)

    return train_loader, val_loader, test_loader, splits
