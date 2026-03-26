#!/usr/bin/env python3
"""Generate a synthetic RadioML-format dataset for pipeline testing.

Creates IQ samples with basic modulation patterns so the full training
pipeline can be validated without downloading the real RadioML dataset.
The synthetic data is NOT realistic — use it only for smoke testing.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pickle
from src.dataset import MODULATIONS, SNRS


def generate_modulated_signal(mod: str, n_samples: int, length: int = 128) -> np.ndarray:
    """Generate simple IQ patterns for each modulation type.

    These are crude approximations — just enough to give each class
    a distinguishable signature so the CNN can learn something.
    """
    t = np.linspace(0, 1, length)
    signals = np.zeros((n_samples, 2, length), dtype=np.float32)

    for i in range(n_samples):
        phase = np.random.uniform(0, 2 * np.pi)
        freq = np.random.uniform(0.05, 0.15)

        if mod in ("BPSK", "8PSK", "QPSK"):
            # PSK: constant envelope, random phase jumps
            n_syms = 8 if mod == "8PSK" else (4 if mod == "QPSK" else 2)
            symbols = np.random.randint(0, n_syms, size=length)
            angles = symbols * (2 * np.pi / n_syms) + phase
            signals[i, 0] = np.cos(angles)
            signals[i, 1] = np.sin(angles)

        elif mod in ("QAM16", "QAM64"):
            # QAM: grid constellation
            m = 4 if mod == "QAM16" else 8
            symbols_i = np.random.randint(-m + 1, m, size=length).astype(float)
            symbols_q = np.random.randint(-m + 1, m, size=length).astype(float)
            signals[i, 0] = symbols_i / m
            signals[i, 1] = symbols_q / m

        elif mod in ("AM-DSB", "AM-SSB"):
            # AM: modulated envelope
            msg = np.sin(2 * np.pi * freq * 3 * t + phase)
            carrier = np.cos(2 * np.pi * freq * 20 * t)
            signals[i, 0] = (1 + 0.5 * msg) * carrier
            signals[i, 1] = (1 + 0.5 * msg) * np.sin(2 * np.pi * freq * 20 * t)
            if mod == "AM-SSB":
                signals[i, 1] *= 0.1  # suppress one sideband crudely

        elif mod in ("WBFM",):
            # FM: frequency-modulated carrier
            msg = np.sin(2 * np.pi * freq * 2 * t + phase)
            phase_mod = np.cumsum(msg) * 0.3
            signals[i, 0] = np.cos(2 * np.pi * freq * 10 * t + phase_mod)
            signals[i, 1] = np.sin(2 * np.pi * freq * 10 * t + phase_mod)

        elif mod in ("GFSK", "CPFSK"):
            # FSK: frequency jumps
            symbols = np.random.choice([-1, 1], size=length // 8)
            freq_signal = np.repeat(symbols, 8)[:length].astype(float)
            phase_mod = np.cumsum(freq_signal) * 0.2
            signals[i, 0] = np.cos(phase_mod + phase)
            signals[i, 1] = np.sin(phase_mod + phase)

        elif mod == "PAM4":
            # PAM: amplitude levels
            symbols = np.random.choice([-3, -1, 1, 3], size=length).astype(float)
            signals[i, 0] = symbols / 3
            signals[i, 1] = np.zeros(length)

        else:
            # Fallback: random
            signals[i, 0] = np.random.randn(length)
            signals[i, 1] = np.random.randn(length)

    return signals


def add_noise(signals: np.ndarray, snr_db: int) -> np.ndarray:
    """Add AWGN at specified SNR."""
    sig_power = np.mean(signals ** 2, axis=(1, 2), keepdims=True)
    sig_power = np.maximum(sig_power, 1e-10)
    noise_power = sig_power / (10 ** (snr_db / 10))
    noise = np.random.randn(*signals.shape).astype(np.float32) * np.sqrt(noise_power)
    return signals + noise


def main():
    data_dir = Path(__file__).resolve().parent.parent / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    out_path = data_dir / "RML2016.10a_dict.pkl"

    if out_path.exists():
        print(f"Dataset already exists: {out_path}")
        print("Delete it first if you want to regenerate.")
        return

    samples_per_mod_snr = 100  # Real dataset has ~1000; keep small for speed
    data_dict = {}

    print(f"Generating synthetic dataset ({len(MODULATIONS)} mods x {len(SNRS)} SNRs x {samples_per_mod_snr} samples)...")

    for mod in MODULATIONS:
        for snr in SNRS:
            clean = generate_modulated_signal(mod, samples_per_mod_snr)
            noisy = add_noise(clean, snr)
            data_dict[(mod, snr)] = noisy

    total = sum(v.shape[0] for v in data_dict.values())
    print(f"Total samples: {total:,}")

    with open(out_path, "wb") as f:
        pickle.dump(data_dict, f)

    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"Saved: {out_path} ({size_mb:.1f} MB)")
    print("\nNOTE: This is SYNTHETIC data for pipeline testing only.")
    print("For real results, download RadioML 2016.10a from Kaggle:")
    print("  kaggle datasets download -d nolasthitnotomorrow/radioml2016-deepsigcom")


if __name__ == "__main__":
    main()
