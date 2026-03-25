"""Model evaluation: per-SNR accuracy, confusion matrix, and plots."""

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import confusion_matrix
from pathlib import Path

from .dataset import MODULATIONS, SNRS


@torch.no_grad()
def predict_all(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Run inference on entire loader.

    Returns:
        preds, labels, snrs — all as numpy arrays
    """
    model.eval()
    all_preds, all_labels, all_snrs = [], [], []

    for batch in loader:
        X, y, snr = batch[0].to(device), batch[1], batch[2]
        logits = model(X)
        preds = logits.argmax(1).cpu().numpy()
        all_preds.append(preds)
        all_labels.append(y.numpy())
        all_snrs.append(snr.numpy())

    return np.concatenate(all_preds), np.concatenate(all_labels), np.concatenate(all_snrs)


def per_snr_accuracy(
    preds: np.ndarray,
    labels: np.ndarray,
    snrs: np.ndarray,
) -> dict[int, float]:
    """Compute classification accuracy at each SNR level."""
    results = {}
    for snr in sorted(set(snrs)):
        mask = snrs == snr
        if mask.sum() > 0:
            results[int(snr)] = float((preds[mask] == labels[mask]).mean())
    return results


def plot_snr_accuracy(
    snr_acc: dict[int, float],
    save_path: str = "results/snr_accuracy.png",
    title: str = "Classification Accuracy vs SNR",
) -> None:
    """Plot accuracy vs SNR curve."""
    Path(save_path).parent.mkdir(parents=True, exist_ok=True)

    snrs = sorted(snr_acc.keys())
    accs = [snr_acc[s] for s in snrs]

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.plot(snrs, accs, "o-", linewidth=2, markersize=6, color="#06b6d4")
    ax.set_xlabel("SNR (dB)", fontsize=12)
    ax.set_ylabel("Accuracy", fontsize=12)
    ax.set_title(title, fontsize=14)
    ax.set_ylim(0, 1.05)
    ax.set_xticks(snrs)
    ax.grid(True, alpha=0.3)
    ax.axhline(y=0.9, color="gray", linestyle="--", alpha=0.5, label="90% target")
    ax.legend()

    fig.tight_layout()
    fig.savefig(save_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved SNR accuracy plot: {save_path}")


def plot_confusion_matrix(
    preds: np.ndarray,
    labels: np.ndarray,
    snrs: np.ndarray,
    min_snr: int = 10,
    save_path: str = "results/confusion_matrix.png",
) -> None:
    """Plot confusion matrix for samples above min_snr."""
    Path(save_path).parent.mkdir(parents=True, exist_ok=True)

    mask = snrs >= min_snr
    cm = confusion_matrix(labels[mask], preds[mask], labels=range(len(MODULATIONS)))
    cm_norm = cm.astype(float) / cm.sum(axis=1, keepdims=True)

    fig, ax = plt.subplots(figsize=(10, 8))
    sns.heatmap(
        cm_norm, annot=True, fmt=".2f", cmap="viridis",
        xticklabels=MODULATIONS, yticklabels=MODULATIONS, ax=ax,
        vmin=0, vmax=1,
    )
    ax.set_xlabel("Predicted", fontsize=12)
    ax.set_ylabel("True", fontsize=12)
    ax.set_title(f"Confusion Matrix (SNR >= {min_snr} dB)", fontsize=14)

    fig.tight_layout()
    fig.savefig(save_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved confusion matrix: {save_path}")


def plot_training_history(
    history: dict,
    save_path: str = "results/training_history.png",
) -> None:
    """Plot training and validation loss/accuracy curves."""
    Path(save_path).parent.mkdir(parents=True, exist_ok=True)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    epochs = range(1, len(history["train_loss"]) + 1)

    ax1.plot(epochs, history["train_loss"], label="Train", linewidth=2)
    ax1.plot(epochs, history["val_loss"], label="Val", linewidth=2)
    ax1.set_xlabel("Epoch")
    ax1.set_ylabel("Loss")
    ax1.set_title("Loss")
    ax1.legend()
    ax1.grid(True, alpha=0.3)

    ax2.plot(epochs, history["train_acc"], label="Train", linewidth=2)
    ax2.plot(epochs, history["val_acc"], label="Val", linewidth=2)
    ax2.set_xlabel("Epoch")
    ax2.set_ylabel("Accuracy")
    ax2.set_title("Accuracy")
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    ax2.set_ylim(0, 1.05)

    fig.suptitle("Training History", fontsize=14)
    fig.tight_layout()
    fig.savefig(save_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved training history: {save_path}")


def full_evaluation(
    model: nn.Module,
    test_loader: DataLoader,
    device: torch.device,
    history: dict | None = None,
    results_dir: str = "results",
) -> dict:
    """Run complete evaluation suite and save all plots.

    Returns dict with overall accuracy and per-SNR results.
    """
    preds, labels, snrs = predict_all(model, test_loader, device)

    overall_acc = float((preds == labels).mean())
    print(f"\nOverall test accuracy: {overall_acc:.4f}")

    snr_acc = per_snr_accuracy(preds, labels, snrs)
    for snr, acc in sorted(snr_acc.items()):
        print(f"  SNR {snr:+3d} dB: {acc:.4f}")

    plot_snr_accuracy(snr_acc, save_path=f"{results_dir}/snr_accuracy.png")
    plot_confusion_matrix(preds, labels, snrs, save_path=f"{results_dir}/confusion_matrix.png")

    if history:
        plot_training_history(history, save_path=f"{results_dir}/training_history.png")

    return {"overall_accuracy": overall_acc, "per_snr": snr_acc}
