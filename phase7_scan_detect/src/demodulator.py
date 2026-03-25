"""Basic demodulation for detected and classified signals."""

import logging
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal as sp_signal

logger = logging.getLogger(__name__)


@dataclass
class DemodResult:
    demod_type: str  # "audio" or "bits"
    preview: str  # hex dump or short description
    audio_path: str | None = None
    samples: np.ndarray | None = None


class Demodulator:
    """Demodulate detected signals based on their classified modulation type."""

    SUPPORTED = {"WBFM", "NFM", "AM-DSB", "AM-SSB", "BPSK", "QPSK", "8PSK"}

    def __init__(self, audio_output_dir: str = "output/audio", max_duration_sec: float = 10.0):
        self.audio_dir = Path(audio_output_dir)
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self.max_duration_sec = max_duration_sec

    def try_demod(
        self,
        iq_samples: np.ndarray,
        offset_hz: float,
        bandwidth_hz: float,
        sample_rate: int,
        modulation: str | None,
    ) -> DemodResult | None:
        """Attempt demodulation based on classified modulation type.

        Args:
            iq_samples: complex64 wideband IQ
            offset_hz: signal offset from center
            bandwidth_hz: signal bandwidth
            sample_rate: capture sample rate
            modulation: classified modulation type

        Returns:
            DemodResult or None if unsupported/failed
        """
        if modulation is None or modulation not in self.SUPPORTED:
            return None

        # Extract and shift to baseband
        segment = self._extract_baseband(
            iq_samples, offset_hz, bandwidth_hz, sample_rate
        )
        if segment is None or len(segment) < 64:
            return None

        try:
            if modulation == "WBFM":
                return self._demod_fm(segment, sample_rate, wideband=True)
            elif modulation == "NFM":
                return self._demod_fm(segment, sample_rate, wideband=False)
            elif modulation in ("AM-DSB", "AM-SSB"):
                return self._demod_am(segment, sample_rate)
            elif modulation in ("BPSK", "QPSK", "8PSK"):
                return self._demod_psk(segment, modulation)
        except Exception as e:
            logger.warning("Demod failed for %s: %s", modulation, e)
            return None

        return None

    def _extract_baseband(
        self,
        iq_samples: np.ndarray,
        offset_hz: float,
        bandwidth_hz: float,
        sample_rate: int,
    ) -> np.ndarray | None:
        """Shift signal to baseband and filter."""
        n = len(iq_samples)
        max_samples = int(self.max_duration_sec * sample_rate)
        if n > max_samples:
            iq_samples = iq_samples[:max_samples]
            n = max_samples

        t = np.arange(n) / sample_rate
        shifted = iq_samples * np.exp(-1j * 2 * np.pi * offset_hz * t).astype(np.complex64)

        # Low-pass filter
        cutoff = max(bandwidth_hz, 10000) / 2
        nyq = sample_rate / 2
        norm_cutoff = min(cutoff / nyq, 0.99)

        try:
            b, a = sp_signal.butter(5, norm_cutoff, btype="low")
            return sp_signal.lfilter(b, a, shifted)
        except Exception:
            return shifted

    def _demod_fm(self, iq: np.ndarray, sample_rate: int) -> DemodResult:
        """FM demodulation via instantaneous frequency."""
        # Instantaneous frequency = d(phase)/dt
        phase_diff = np.angle(iq[1:] * np.conj(iq[:-1]))

        # Decimate to audio rate (~48 kHz)
        audio_rate = 48000
        decim = max(1, sample_rate // audio_rate)
        audio = sp_signal.decimate(phase_diff, decim, zero_phase=True)

        # Normalize
        if np.max(np.abs(audio)) > 0:
            audio = audio / np.max(np.abs(audio)) * 0.9

        return DemodResult(
            demod_type="audio",
            preview=f"FM audio: {len(audio)} samples @ {audio_rate} Hz",
            samples=audio.astype(np.float32),
        )

    def _demod_am(self, iq: np.ndarray, sample_rate: int) -> DemodResult:
        """AM demodulation via envelope detection."""
        # Envelope = |I + jQ|
        envelope = np.abs(iq)

        # Remove DC
        envelope = envelope - np.mean(envelope)

        # Decimate to audio rate
        audio_rate = 48000
        decim = max(1, sample_rate // audio_rate)
        audio = sp_signal.decimate(envelope, decim, zero_phase=True)

        # Normalize
        if np.max(np.abs(audio)) > 0:
            audio = audio / np.max(np.abs(audio)) * 0.9

        return DemodResult(
            demod_type="audio",
            preview=f"AM audio: {len(audio)} samples @ {audio_rate} Hz",
            samples=audio.astype(np.float32),
        )

    def _demod_psk(self, iq: np.ndarray, modulation: str) -> DemodResult:
        """PSK demodulation — extract constellation and bit estimates."""
        # Simple symbol timing: downsample to approximate symbol rate
        # Assume ~9600 baud for narrowband digital
        approx_sps = max(4, len(iq) // 256)  # samples per symbol estimate
        symbols = iq[::approx_sps]

        if modulation == "BPSK":
            # Decision: real part sign
            bits = (symbols.real > 0).astype(np.uint8)
        elif modulation == "QPSK":
            # 2 bits per symbol from I/Q signs
            bit_i = (symbols.real > 0).astype(np.uint8)
            bit_q = (symbols.imag > 0).astype(np.uint8)
            bits = np.zeros(len(symbols) * 2, dtype=np.uint8)
            bits[0::2] = bit_i
            bits[1::2] = bit_q
        elif modulation == "8PSK":
            # 3 bits per symbol from phase
            phases = np.angle(symbols)
            # Map phase to 3-bit symbol (8 sectors)
            sector = ((phases + np.pi) / (2 * np.pi) * 8).astype(int) % 8
            bits = np.unpackbits(sector.astype(np.uint8))
        else:
            bits = np.array([], dtype=np.uint8)

        # Format as hex preview
        if len(bits) >= 8:
            byte_count = len(bits) // 8
            bytes_arr = np.packbits(bits[: byte_count * 8])
            hex_preview = bytes_arr[:32].tobytes().hex()
            preview = f"{modulation} bits: {hex_preview}... ({byte_count} bytes)"
        else:
            preview = f"{modulation}: too few symbols ({len(symbols)})"

        return DemodResult(
            demod_type="bits",
            preview=preview,
        )
