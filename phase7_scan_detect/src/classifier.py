"""Bridge to Phase 6 AMR models for real-time signal classification."""

import importlib.util
import logging
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from scipy import signal as sp_signal

# Import Phase 6 modules by file path to avoid namespace collision with Phase 7's src/
PHASE6_ROOT = Path(__file__).resolve().parent.parent.parent / "phase6_signal_recognition"


def _import_phase6_module(name: str):
    """Import a Phase 6 module by file path."""
    module_path = PHASE6_ROOT / "src" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"phase6_{name}", str(module_path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_models_mod = _import_phase6_module("models")
_preproc_mod = _import_phase6_module("preprocessing")
_dataset_mod = _import_phase6_module("dataset")

get_model = _models_mod.get_model
normalize_iq = _preproc_mod.normalize_iq
amplitude_normalize = _preproc_mod.amplitude_normalize
MODULATIONS = _dataset_mod.MODULATIONS

logger = logging.getLogger(__name__)

MODEL_INPUT_LENGTH = 128  # Phase 6 models expect (batch, 2, 128)


@dataclass
class ClassificationResult:
    modulation: str
    confidence: float
    top_k: list[tuple[str, float]]
    inference_ms: float


class SignalClassifier:
    """Load a Phase 6 AMR model and classify IQ signal segments."""

    def __init__(
        self,
        model_name: str = "vtcnn2",
        checkpoint_path: str | None = None,
        min_snr_db: float = 5.0,
        top_k: int = 3,
    ):
        self.model_name = model_name
        self.min_snr_db = min_snr_db
        self.top_k = top_k

        # Determine device
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        # Load model
        self.model = get_model(model_name)
        self.model.to(self.device)

        # Load checkpoint if available
        if checkpoint_path is None:
            checkpoint_path = str(PHASE6_ROOT / "models" / f"{model_name}.pt")

        ckpt_path = Path(checkpoint_path)
        if ckpt_path.exists():
            ckpt = torch.load(str(ckpt_path), map_location=self.device, weights_only=True)
            if "model_state_dict" in ckpt:
                self.model.load_state_dict(ckpt["model_state_dict"])
                logger.info(
                    "Loaded checkpoint: %s (val_acc=%.3f)",
                    ckpt_path.name,
                    ckpt.get("val_acc", -1),
                )
            else:
                self.model.load_state_dict(ckpt)
                logger.info("Loaded state dict: %s", ckpt_path.name)
        else:
            logger.warning("No checkpoint at %s — using random weights", ckpt_path)

        self.model.eval()

    def classify(
        self,
        iq_samples: np.ndarray,
        detection_offset_hz: float,
        detection_bandwidth_hz: float,
        sample_rate: int,
        snr_db: float,
    ) -> ClassificationResult | None:
        """Classify a detected signal region.

        Args:
            iq_samples: complex64 wideband IQ capture
            detection_offset_hz: frequency offset of detected signal from center
            detection_bandwidth_hz: bandwidth of detected signal
            sample_rate: capture sample rate
            snr_db: estimated SNR of the detection

        Returns:
            ClassificationResult or None if SNR too low
        """
        if snr_db < self.min_snr_db:
            return None

        # Extract the signal segment
        segment = self._extract_signal(
            iq_samples, detection_offset_hz, detection_bandwidth_hz, sample_rate
        )
        if segment is None:
            return None

        # Prepare for model input: shape (1, 2, 128)
        prepared = self._prepare_for_model(segment)

        # Run inference
        t0 = time.perf_counter()
        with torch.no_grad():
            logits = self.model(prepared)
            probs = torch.softmax(logits, dim=1).squeeze(0).cpu().numpy()
        inference_ms = (time.perf_counter() - t0) * 1000

        # Get top-K predictions
        top_indices = np.argsort(probs)[::-1][: self.top_k]
        top_k = [(MODULATIONS[i], float(probs[i])) for i in top_indices]
        best_mod = MODULATIONS[top_indices[0]]
        best_conf = float(probs[top_indices[0]])

        return ClassificationResult(
            modulation=best_mod,
            confidence=best_conf,
            top_k=top_k,
            inference_ms=inference_ms,
        )

    def _extract_signal(
        self,
        iq_samples: np.ndarray,
        offset_hz: float,
        bandwidth_hz: float,
        sample_rate: int,
    ) -> np.ndarray | None:
        """Frequency-shift and filter to isolate the detected signal."""
        n = len(iq_samples)
        t = np.arange(n) / sample_rate

        # Shift signal to baseband
        shifted = iq_samples * np.exp(-1j * 2 * np.pi * offset_hz * t).astype(np.complex64)

        # Low-pass filter to signal bandwidth
        cutoff = max(bandwidth_hz, 10000) / 2  # at least 10 kHz
        nyq = sample_rate / 2
        normalized_cutoff = min(cutoff / nyq, 0.99)

        try:
            b, a = sp_signal.butter(5, normalized_cutoff, btype="low")
            filtered = sp_signal.lfilter(b, a, shifted)
        except Exception:
            filtered = shifted

        # Decimate to roughly match model expectations
        target_rate = bandwidth_hz * 2 if bandwidth_hz > 0 else sample_rate
        decim_factor = max(1, int(sample_rate / target_rate))
        if decim_factor > 1:
            filtered = filtered[::decim_factor]

        if len(filtered) < MODEL_INPUT_LENGTH:
            return None

        return filtered[:max(MODEL_INPUT_LENGTH * 4, len(filtered))]

    def _prepare_for_model(self, segment: np.ndarray) -> torch.Tensor:
        """Resample to 128 points and format as (1, 2, 128) tensor."""
        # Resample to exactly MODEL_INPUT_LENGTH
        if len(segment) != MODEL_INPUT_LENGTH:
            segment = sp_signal.resample(segment, MODEL_INPUT_LENGTH)

        # Split into I/Q channels: shape (1, 2, 128)
        iq = np.stack([segment.real, segment.imag], axis=0).astype(np.float32)
        iq = iq[np.newaxis, :, :]  # add batch dim

        # Apply Phase 6 preprocessing
        iq = normalize_iq(iq)
        iq = amplitude_normalize(iq)

        return torch.from_numpy(iq).to(self.device)
