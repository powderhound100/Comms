"""GROUNDLINK Radio — Live SDR audio receiver with WebSocket streaming.

Separate from the scanner: tunes to a single frequency, demodulates
audio (WFM, NFM, AM), and streams PCM + spectrum to the browser.

Architecture:
  - Simple async loop: capture IQ via run_in_executor, demod, send JSON
  - read_samples() blocking naturally paces the loop at real-time
  - Audio sent as base64 float32 in JSON text frames
  - Spectrum sent as JSON text frames every 3rd cycle

Usage:
    python radio_server.py [--port 8770] [--freq 94.9] [--mode wfm]
"""

import asyncio
import base64
import json
import logging
import sys
import os
import time
from urllib.parse import urlparse, parse_qs

import click
import numpy as np
from scipy import signal as sp_signal

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("radio")


class RadioReceiver:
    """Single-frequency SDR receiver with audio demodulation."""

    def __init__(self):
        self.sdr = None
        self.freq_hz: int = int(94.9e6)
        self.mode: str = "wfm"  # wfm, nfm, am
        self.sample_rate: int = 2_400_000
        self.running: bool = False
        self._clients: set = set()
        # De-emphasis IIR filter state (scipy zi)
        self._deemph_zi: np.ndarray | None = None

    def open_sdr(self):
        if sys.platform == "win32":
            dll_dir = r"D:\tools\rtl-sdr\x64"
            if os.path.isdir(dll_dir):
                os.add_dll_directory(dll_dir)
        from rtlsdr import RtlSdr
        if self.sdr:
            try:
                self.sdr.close()
            except Exception:
                pass
        self.sdr = RtlSdr()
        self.sdr.sample_rate = self.sample_rate
        self.sdr.gain = 40
        self.sdr.center_freq = self.freq_hz
        logger.info("SDR opened: %.3f MHz, gain=40 dB", self.freq_hz / 1e6)

    def close_sdr(self):
        if self.sdr:
            try:
                self.sdr.close()
            except Exception:
                pass
            self.sdr = None

    def tune(self, freq_hz: int, mode: str = "wfm"):
        self.freq_hz = freq_hz
        self.mode = mode
        self._deemph_zi = None  # Reset filter state on retune
        if self.sdr:
            self.sdr.center_freq = freq_hz
        logger.info("Tuned: %.3f MHz [%s]", freq_hz / 1e6, mode.upper())

    def audio_rate(self) -> int:
        """Output audio sample rate for current mode."""
        if self.mode == "wfm":
            return 48000
        return 16000

    @staticmethod
    def _deemph_coeffs(tau: float, fs: int):
        """First-order IIR de-emphasis: b, a coefficients."""
        alpha = 1.0 - np.exp(-1.0 / (fs * tau))
        return np.array([alpha], dtype=np.float64), np.array([1.0, -(1.0 - alpha)], dtype=np.float64)

    def demod(self, iq: np.ndarray) -> tuple[np.ndarray, int]:
        """Demodulate IQ to audio. Returns (audio_samples, sample_rate)."""
        if self.mode == "wfm":
            return self._demod_wfm(iq)
        elif self.mode == "nfm":
            return self._demod_nfm(iq)
        elif self.mode == "am":
            return self._demod_am(iq)
        return np.array([], dtype=np.float32), 48000

    def _demod_wfm(self, iq: np.ndarray) -> tuple[np.ndarray, int]:
        """Wideband FM demodulation with multi-stage decimation.

        2.4M → 480k → 96k → 48k  (factors: 5, 5, 2)
        """
        phase_diff = np.angle(iq[1:] * np.conj(iq[:-1]))
        audio_rate = 48000
        # Multi-stage decimation (each factor ≤13 for stability)
        audio = sp_signal.decimate(phase_diff, 5, zero_phase=False)
        audio = sp_signal.decimate(audio, 5, zero_phase=False)
        audio = sp_signal.decimate(audio, 2, zero_phase=False)
        # De-emphasis (75 μs) via lfilter with persistent state
        b, a = self._deemph_coeffs(75e-6, audio_rate)
        if self._deemph_zi is None:
            self._deemph_zi = sp_signal.lfilter_zi(b, a) * audio[0]
        out, self._deemph_zi = sp_signal.lfilter(b, a, audio, zi=self._deemph_zi)
        peak = np.max(np.abs(out))
        if peak > 0:
            out = out / peak * 0.9
        return out.astype(np.float32), audio_rate

    def _demod_nfm(self, iq: np.ndarray) -> tuple[np.ndarray, int]:
        """Narrowband FM demodulation with multi-stage decimation.

        2.4M → 480k → 96k → 16k  (factors: 5, 5, 6)
        """
        phase_diff = np.angle(iq[1:] * np.conj(iq[:-1]))
        # Narrow filter for voice
        nyq = self.sample_rate / 2
        cutoff = min(5000 / nyq, 0.99)
        try:
            b, a = sp_signal.butter(4, cutoff, btype="low")
            phase_diff = sp_signal.lfilter(b, a, phase_diff)
        except Exception:
            pass
        audio_rate = 16000
        # Multi-stage decimation (each factor ≤13 for stability)
        audio = sp_signal.decimate(phase_diff, 5, zero_phase=False)
        audio = sp_signal.decimate(audio, 5, zero_phase=False)
        audio = sp_signal.decimate(audio, 6, zero_phase=False)
        # De-emphasis (50 μs) via lfilter with persistent state
        b, a = self._deemph_coeffs(50e-6, audio_rate)
        if self._deemph_zi is None:
            self._deemph_zi = sp_signal.lfilter_zi(b, a) * audio[0]
        out, self._deemph_zi = sp_signal.lfilter(b, a, audio, zi=self._deemph_zi)
        peak = np.max(np.abs(out))
        if peak > 0:
            out = out / peak * 0.9
        return out.astype(np.float32), audio_rate

    def _demod_am(self, iq: np.ndarray) -> tuple[np.ndarray, int]:
        """AM envelope detection with multi-stage decimation.

        2.4M → 480k → 96k → 16k  (factors: 5, 5, 6)
        """
        envelope = np.abs(iq)
        envelope = envelope - np.mean(envelope)
        nyq = self.sample_rate / 2
        try:
            b, a = sp_signal.butter(4, [300 / nyq, min(3400 / nyq, 0.99)], btype="band")
            envelope = sp_signal.lfilter(b, a, envelope)
        except Exception:
            pass
        audio_rate = 16000
        # Multi-stage decimation (each factor ≤13 for stability)
        audio = sp_signal.decimate(envelope, 5, zero_phase=False)
        audio = sp_signal.decimate(audio, 5, zero_phase=False)
        audio = sp_signal.decimate(audio, 6, zero_phase=False)
        peak = np.max(np.abs(audio))
        if peak > 0:
            audio = audio / peak * 0.9
        return audio.astype(np.float32), audio_rate

    def compute_psd(self, iq: np.ndarray) -> list[float]:
        """Compute PSD in dBFS for spectrum display."""
        freqs, psd = sp_signal.welch(iq, fs=self.sample_rate, nperseg=1024, return_onesided=False)
        psd_db = 10 * np.log10(psd + 1e-12)
        # Reorder so negative freqs come first (DC in center)
        n = len(psd_db)
        psd_db = np.concatenate([psd_db[n // 2:], psd_db[:n // 2]])
        return psd_db.tolist()


async def radio_handler(websocket, receiver: RadioReceiver):
    """Handle a single WebSocket client — stream audio + spectrum."""
    import websockets

    # Parse tune params from URL
    path = websocket.request.path if hasattr(websocket, 'request') else ''
    query = {}
    try:
        parsed = urlparse(f"ws://localhost{path}")
        query = parse_qs(parsed.query)
    except Exception:
        pass

    freq = int(query.get("freq", [str(receiver.freq_hz)])[0])
    mode = query.get("mode", [receiver.mode])[0]
    receiver.tune(freq, mode)

    receiver._clients.add(websocket)
    logger.info("Client connected (%d total)", len(receiver._clients))

    try:
        # Read loop — handle tune commands from client
        async def read_commands():
            try:
                async for msg in websocket:
                    try:
                        data = json.loads(msg)
                        if data.get("type") == "tune":
                            receiver.tune(
                                int(data.get("freq_hz", receiver.freq_hz)),
                                data.get("mode", receiver.mode),
                            )
                    except Exception:
                        pass
            except websockets.exceptions.ConnectionClosed:
                pass

        cmd_task = asyncio.create_task(read_commands())

        # Stream loop — capture, demod, send (simple async loop)
        # read_samples() blocking call naturally paces at real-time
        frame_count = 0
        loop = asyncio.get_event_loop()
        while True:
            if not receiver.sdr:
                await asyncio.sleep(1)
                continue

            try:
                t0 = time.monotonic()

                # Capture ~218ms of IQ at 2.4 Msps
                iq = await loop.run_in_executor(
                    None, receiver.sdr.read_samples, 524288
                )
                t_capture = time.monotonic()

                # Demod to audio
                audio, audio_rate = receiver.demod(iq)
                t_demod = time.monotonic()

                # Encode audio as base64 float32
                audio_b64 = base64.b64encode(audio.tobytes()).decode('ascii')

                # Send audio chunk
                await websocket.send(json.dumps({
                    "type": "audio",
                    "samples": audio_b64,
                    "sample_rate": audio_rate,
                    "freq_hz": receiver.freq_hz,
                    "mode": receiver.mode,
                }))
                t_send = time.monotonic()

                # Send spectrum every 3rd frame
                frame_count += 1
                if frame_count % 3 == 0:
                    psd = receiver.compute_psd(iq)
                    await websocket.send(json.dumps({
                        "type": "spectrum",
                        "psd_dbfs": psd[::4],
                        "center_freq_hz": receiver.freq_hz,
                        "bandwidth_hz": receiver.sample_rate,
                    }))

                # Timing log
                capture_ms = (t_capture - t0) * 1000
                demod_ms = (t_demod - t_capture) * 1000
                send_ms = (t_send - t_demod) * 1000
                total_ms = (t_send - t0) * 1000
                audio_dur_ms = len(audio) / audio_rate * 1000
                logger.info(
                    "Cycle: capture=%.0fms demod=%.0fms send=%.0fms total=%.0fms (%.0fms audio)",
                    capture_ms, demod_ms, send_ms, total_ms, audio_dur_ms,
                )

            except websockets.exceptions.ConnectionClosed:
                break
            except Exception as e:
                logger.warning("Stream error: %s", e)
                await asyncio.sleep(0.5)

            await asyncio.sleep(0.005)  # Yield

    except Exception:
        pass
    finally:
        receiver._clients.discard(websocket)
        logger.info("Client disconnected (%d remaining)", len(receiver._clients))


@click.command()
@click.option("--port", default=8770, help="WebSocket port")
@click.option("--freq", default=94.9, help="Initial frequency (MHz)")
@click.option("--mode", default="wfm", type=click.Choice(["wfm", "nfm", "am"]), help="Demod mode")
def main(port, freq, mode):
    """GROUNDLINK Radio — Live SDR audio receiver."""
    import websockets

    receiver = RadioReceiver()
    receiver.freq_hz = int(freq * 1e6)
    receiver.mode = mode

    async def serve():
        receiver.open_sdr()
        logger.info("=" * 50)
        logger.info("GROUNDLINK Radio")
        logger.info("Frequency: %.3f MHz [%s]", freq, mode.upper())
        logger.info("WebSocket: ws://0.0.0.0:%d", port)
        logger.info("Audio: JSON base64 float32, ~218ms chunks")
        logger.info("=" * 50)

        async with websockets.serve(
            lambda ws: radio_handler(ws, receiver),
            "0.0.0.0", port,
        ):
            try:
                await asyncio.Future()  # Run forever
            except asyncio.CancelledError:
                pass
            finally:
                receiver.close_sdr()

    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        logger.info("Radio shutting down")


if __name__ == "__main__":
    main()
