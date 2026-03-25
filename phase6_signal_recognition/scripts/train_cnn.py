#!/usr/bin/env python3
"""Train an AMR CNN model on RadioML 2016.10a."""

import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import click
import torch

from src.dataset import get_dataloaders, MODULATIONS
from src.models import get_model, MODELS
from src.train import train_model
from src.evaluate import full_evaluation
from src.utils import seed_everything, get_device


@click.command()
@click.option("--model", "model_name", default="vtcnn2", type=click.Choice(list(MODELS.keys())), help="Model architecture")
@click.option("--epochs", default=30, help="Number of training epochs")
@click.option("--batch-size", default=256, help="Batch size")
@click.option("--lr", default=0.001, help="Learning rate")
@click.option("--seed", default=42, help="Random seed")
@click.option("--data-dir", default="data", help="Dataset directory")
@click.option("--save-dir", default="models", help="Model checkpoint directory")
@click.option("--results-dir", default="results", help="Results/plots directory")
def main(model_name, epochs, batch_size, lr, seed, data_dir, save_dir, results_dir):
    """Train an AMR model on RadioML 2016.10a."""
    seed_everything(seed)
    device = get_device()
    print(f"Device: {device}")
    print(f"Model: {model_name}")
    print(f"Classes: {len(MODULATIONS)} ({', '.join(MODULATIONS)})")
    print()

    # Load data
    print("Loading dataset...")
    train_loader, val_loader, test_loader, splits = get_dataloaders(
        data_dir=data_dir, batch_size=batch_size, seed=seed
    )
    print(f"Train: {len(splits['X_train']):,} | Val: {len(splits['X_val']):,} | Test: {len(splits['X_test']):,}")
    print()

    # Build model
    model = get_model(model_name, num_classes=len(MODULATIONS))
    param_count = sum(p.numel() for p in model.parameters())
    print(f"Parameters: {param_count:,}")
    print()

    # Train
    history = train_model(
        model=model,
        train_loader=train_loader,
        val_loader=val_loader,
        device=device,
        epochs=epochs,
        lr=lr,
        save_dir=save_dir,
        model_name=model_name,
    )

    # Load best checkpoint and evaluate
    checkpoint = torch.load(f"{save_dir}/{model_name}.pt", map_location=device, weights_only=True)
    model.load_state_dict(checkpoint["model_state_dict"])
    print(f"\nLoaded best checkpoint (epoch {checkpoint['epoch']}, val_acc={checkpoint['val_acc']:.4f})")

    results = full_evaluation(
        model=model,
        test_loader=test_loader,
        device=device,
        history=history,
        results_dir=results_dir,
    )

    print(f"\nDone! Results saved to {results_dir}/")


if __name__ == "__main__":
    main()
