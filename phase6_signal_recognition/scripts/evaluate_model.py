#!/usr/bin/env python3
"""Evaluate a trained AMR model on RadioML 2016.10a test set."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import click
import torch

from src.dataset import get_dataloaders, MODULATIONS
from src.models import get_model, MODELS
from src.evaluate import full_evaluation
from src.utils import seed_everything, get_device


@click.command()
@click.option("--model", "model_name", default="vtcnn2", type=click.Choice(list(MODELS.keys())), help="Model architecture")
@click.option("--checkpoint", default=None, help="Path to checkpoint (default: models/<model>.pt)")
@click.option("--data-dir", default="data", help="Dataset directory")
@click.option("--results-dir", default="results", help="Results/plots directory")
@click.option("--seed", default=42, help="Random seed")
def main(model_name, checkpoint, data_dir, results_dir, seed):
    """Evaluate a trained model and generate plots."""
    seed_everything(seed)
    device = get_device()

    # Load checkpoint
    ckpt_path = checkpoint or f"models/{model_name}.pt"
    if not Path(ckpt_path).exists():
        print(f"Checkpoint not found: {ckpt_path}")
        print("Train a model first: python scripts/train_cnn.py")
        sys.exit(1)

    print(f"Model: {model_name}")
    print(f"Checkpoint: {ckpt_path}")
    print(f"Device: {device}")
    print()

    # Load data (only need test set)
    print("Loading dataset...")
    _, _, test_loader, splits = get_dataloaders(data_dir=data_dir, seed=seed)
    print(f"Test samples: {len(splits['X_test']):,}")
    print()

    # Load model
    model = get_model(model_name, num_classes=len(MODULATIONS))
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=True)
    model.load_state_dict(ckpt["model_state_dict"])
    model = model.to(device)
    print(f"Loaded checkpoint from epoch {ckpt['epoch']} (val_acc={ckpt['val_acc']:.4f})")
    print()

    # Evaluate
    results = full_evaluation(
        model=model,
        test_loader=test_loader,
        device=device,
        results_dir=results_dir,
    )

    print(f"\nResults saved to {results_dir}/")


if __name__ == "__main__":
    main()
