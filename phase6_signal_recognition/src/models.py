"""CNN model architectures for Automatic Modulation Recognition."""

import torch
import torch.nn as nn


class VTCNN2(nn.Module):
    """VT-CNN2 baseline model from O'Shea et al. (2016).

    Architecture: two Conv1d layers on raw IQ input (2, 128),
    followed by fully connected layers for classification.

    Expected accuracy: ~55-60% overall, >85% at high SNR on RadioML 2016.10a.
    """

    def __init__(self, num_classes: int = 11, dropout: float = 0.5):
        super().__init__()

        self.features = nn.Sequential(
            nn.Conv1d(2, 64, kernel_size=8, padding="same"),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Conv1d(64, 64, kernel_size=8, padding="same"),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Flatten(),
        )

        # 64 channels * 128 time steps
        self.classifier = nn.Sequential(
            nn.Linear(64 * 128, 128),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(128, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass.

        Args:
            x: shape (batch, 2, 128) — IQ samples

        Returns:
            logits: shape (batch, num_classes)
        """
        x = self.features(x)
        return self.classifier(x)


class ResBlock1d(nn.Module):
    """Residual block for 1D convolutions."""

    def __init__(self, channels: int, kernel_size: int = 5):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv1d(channels, channels, kernel_size, padding="same"),
            nn.BatchNorm1d(channels),
            nn.ReLU(),
            nn.Conv1d(channels, channels, kernel_size, padding="same"),
            nn.BatchNorm1d(channels),
        )
        self.relu = nn.ReLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.relu(self.block(x) + x)


class ResNet1d(nn.Module):
    """Deeper ResNet-style 1D CNN for improved accuracy.

    Uses residual blocks with batch normalization.
    """

    def __init__(self, num_classes: int = 11, dropout: float = 0.3):
        super().__init__()

        self.stem = nn.Sequential(
            nn.Conv1d(2, 64, kernel_size=7, padding="same"),
            nn.BatchNorm1d(64),
            nn.ReLU(),
        )

        self.res_blocks = nn.Sequential(
            ResBlock1d(64),
            ResBlock1d(64),
            ResBlock1d(64),
        )

        self.pool = nn.AdaptiveAvgPool1d(1)

        self.classifier = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(64, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.stem(x)
        x = self.res_blocks(x)
        x = self.pool(x).squeeze(-1)
        return self.classifier(x)


MODELS = {
    "vtcnn2": VTCNN2,
    "resnet1d": ResNet1d,
}


def get_model(name: str = "vtcnn2", **kwargs) -> nn.Module:
    """Get model by name."""
    if name not in MODELS:
        raise ValueError(f"Unknown model: {name}. Choose from: {list(MODELS.keys())}")
    return MODELS[name](**kwargs)
