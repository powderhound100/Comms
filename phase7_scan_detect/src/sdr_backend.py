"""SDR hardware abstraction with mock mode for development without hardware."""

import logging
import numpy as np
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class SDRConfig:
    device_index: int = 0
    sample_rate: int = 2_400_000
    gain: float | str = 40.0  # dB or "auto"
    freq_correction_ppm: int = 0
    direct_sampling: bool = False


class SDRDevice:
    """Unified SDR interface with real (pyrtlsdr) and mock backends."""

    def __init__(self, config: SDRConfig, mock: bool = False):
        self.config = config
        self.mock = mock
        self._device = None
        self._center_freq: int = 100_000_000

    def open(self) -> None:
        if self.mock:
            logger.info("SDR mock mode — no hardware required")
            return

        try:
            from rtlsdr import RtlSdr
            self._device = RtlSdr(self.config.device_index)
            self._device.sample_rate = self.config.sample_rate
            self._device.freq_correction = self.config.freq_correction_ppm
            if self.config.gain == "auto":
                self._device.gain = "auto"
            else:
                self._device.gain = float(self.config.gain)
            logger.info(
                "SDR opened: device=%d, rate=%d, gain=%s",
                self.config.device_index,
                self.config.sample_rate,
                self.config.gain,
            )
        except ImportError:
            raise RuntimeError(
                "pyrtlsdr not installed. Install with: pip install pyrtlsdr\n"
                "Or use --mock flag for development without hardware."
            )
        except Exception as e:
            raise RuntimeError(f"Failed to open SDR device: {e}")

    def close(self) -> None:
        if self._device is not None:
            self._device.close()
            self._device = None
            logger.info("SDR device closed")

    def set_center_freq(self, freq_hz: int) -> None:
        self._center_freq = freq_hz
        if self._device is not None:
            self._device.center_freq = freq_hz

    def get_center_freq(self) -> int:
        return self._center_freq

    def read_samples(self, num_samples: int = 262144) -> np.ndarray:
        """Read IQ samples. Returns complex64 array of length num_samples."""
        if self.mock:
            return self._generate_mock_samples(num_samples)

        try:
            samples = self._device.read_samples(num_samples)
            return np.array(samples, dtype=np.complex64)
        except Exception as e:
            logger.warning("SDR read error (sample drop?): %s", e)
            return np.zeros(num_samples, dtype=np.complex64)

    def _generate_mock_samples(self, num_samples: int) -> np.ndarray:
        """Generate synthetic IQ with realistic noise + injected signals."""
        t = np.arange(num_samples) / self.config.sample_rate

        # Base noise floor
        noise = (
            np.random.randn(num_samples) + 1j * np.random.randn(num_samples)
        ).astype(np.complex64) * 0.01

        # Inject synthetic signals based on frequency to make scanning interesting
        signals_to_inject = self._get_mock_signals()
        for sig in signals_to_inject:
            offset_hz = sig["offset"]
            sig_type = sig["type"]
            amplitude = sig["amplitude"]

            if sig_type == "fm":
                # FM signal: carrier with frequency modulation
                mod_signal = np.sin(2 * np.pi * 50 * t)  # 50 Hz audio tone
                phase = 2 * np.pi * offset_hz * t + 5000 * np.cumsum(mod_signal) / self.config.sample_rate
                noise += amplitude * np.exp(1j * phase).astype(np.complex64)
            elif sig_type == "am":
                # AM signal: carrier with amplitude modulation
                carrier = np.exp(1j * 2 * np.pi * offset_hz * t)
                mod = 1.0 + 0.7 * np.sin(2 * np.pi * 400 * t)
                noise += amplitude * (mod * carrier).astype(np.complex64)
            elif sig_type == "bpsk":
                # BPSK: binary phase shifts
                symbol_rate = 9600
                symbols_needed = int(num_samples * symbol_rate / self.config.sample_rate) + 1
                bits = np.random.choice([-1, 1], size=symbols_needed)
                samples_per_symbol = self.config.sample_rate // symbol_rate
                modulated = np.repeat(bits, samples_per_symbol)[:num_samples]
                carrier = np.exp(1j * 2 * np.pi * offset_hz * t)
                noise += amplitude * (modulated * carrier).astype(np.complex64)
            elif sig_type == "qpsk":
                # QPSK: 4 phase states
                symbol_rate = 9600
                symbols_needed = int(num_samples * symbol_rate / self.config.sample_rate) + 1
                phases = np.random.choice([np.pi/4, 3*np.pi/4, 5*np.pi/4, 7*np.pi/4], size=symbols_needed)
                samples_per_symbol = self.config.sample_rate // symbol_rate
                phase_seq = np.repeat(phases, samples_per_symbol)[:num_samples]
                carrier = np.exp(1j * (2 * np.pi * offset_hz * t + phase_seq))
                noise += amplitude * carrier.astype(np.complex64)

        return noise

    def _get_mock_signals(self) -> list[dict]:
        """Return synthetic signals to inject based on current center frequency."""
        signals = []
        freq_mhz = self._center_freq / 1e6

        # Inject signals at certain "interesting" frequencies
        if 87.0 <= freq_mhz <= 108.0:
            # FM broadcast band — inject a couple FM stations
            signals.append({"offset": 200_000, "type": "fm", "amplitude": 0.5})
            signals.append({"offset": -600_000, "type": "fm", "amplitude": 0.3})
        elif 118.0 <= freq_mhz <= 137.0:
            # VHF aviation — AM voice
            signals.append({"offset": 100_000, "type": "am", "amplitude": 0.15})
        elif 144.0 <= freq_mhz <= 148.0:
            # 2m amateur — BPSK packet
            signals.append({"offset": 50_000, "type": "bpsk", "amplitude": 0.2})
        elif 430.0 <= freq_mhz <= 440.0:
            # 70cm amateur — QPSK
            signals.append({"offset": -100_000, "type": "qpsk", "amplitude": 0.25})
        elif 1688.0 <= freq_mhz <= 1700.0:
            # GOES LRIT/HRIT — BPSK
            signals.append({"offset": 0, "type": "bpsk", "amplitude": 0.1})

        # Random weak signal 30% of the time
        if np.random.random() < 0.3:
            offset = np.random.randint(-800_000, 800_000)
            sig_type = np.random.choice(["fm", "am", "bpsk", "qpsk"])
            signals.append({"offset": offset, "type": sig_type, "amplitude": 0.08})

        return signals
