"""GROUNDLINK Radio — Live SDR audio receiver with WebSocket streaming.

Separate from the scanner: tunes to a single frequency, demodulates
audio (WFM, NFM, AM), and streams PCM + spectrum to the browser.

Usage:
    python radio_server.py [--port 8770] [--freq 94.9] [--mode wfm]
"""

import asyncio
import base64
import json
import logging
import sys
import os
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
        if self.sdr:
            self.sdr.center_freq = freq_hz
        logger.info("Tuned: %.3f MHz [%s]", freq_hz / 1e6, mode.upper())

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
        """Wideband FM demodulation."""
        phase_diff = np.angle(iq[1:] * np.conj(iq[:-1]))
        audio_rate = 48000
        decim = max(1, self.sample_rate // audio_rate)
        audio = sp_signal.decimate(phase_diff, decim, zero_phase=True)
        # De-emphasis (75 μs)
        tau = 75e-6
        alpha = 1.0 - np.exp(-1.0 / (audio_rate * tau))
        out = np.zeros_like(audio)
        out[0] = audio[0]
        for i in range(1, len(audio)):
            out[i] = out[i - 1] + alpha * (audio[i] - out[i - 1])
        if np.max(np.abs(out)) > 0:
            out = out / np.max(np.abs(out)) * 0.9
        return out.astype(np.float32), audio_rate

    def _demod_nfm(self, iq: np.ndarray) -> tuple[np.ndarray, int]:
        """Narrowband FM demodulation."""
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
        decim = max(1, self.sample_rate // audio_rate)
        audio = sp_signal.decimate(phase_diff, decim, zero_phase=True)
        # De-emphasis (50 μs)
        tau = 50e-6
        alpha = 1.0 - np.exp(-1.0 / (audio_rate * tau))
        out = np.zeros_like(audio)
        out[0] = audio[0]
        for i in range(1, len(audio)):
            out[i] = out[i - 1] + alpha * (audio[i] - out[i - 1])
        if np.max(np.abs(out)) > 0:
            out = out / np.max(np.abs(out)) * 0.9
        return out.astype(np.float32), audio_rate

    def _demod_am(self, iq: np.ndarray) -> tuple[np.ndarray, int]:
        """AM envelope detection."""
        envelope = np.abs(iq)
        envelope = envelope - np.mean(envelope)
        nyq = self.sample_rate / 2
        try:
            b, a = sp_signal.butter(4, [300 / nyq, min(3400 / nyq, 0.99)], btype="band")
            envelope = sp_signal.lfilter(b, a, envelope)
        except Exception:
            pass
        audio_rate = 16000
        decim = max(1, self.sample_rate // audio_rate)
        audio = sp_signal.decimate(envelope, decim, zero_phase=True)
        if np.max(np.abs(audio)) > 0:
            audio = audio / np.max(np.abs(audio)) * 0.9
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

        # Stream loop — capture, demod, send
        while True:
            if not receiver.sdr:
                await asyncio.sleep(1)
                continue

            try:
                loop = asyncio.get_event_loop()
                iq = await loop.run_in_executor(
                    None, receiver.sdr.read_samples, 131072  # ~55ms at 2.4 Msps
                )

                # Demod to audio
                audio, audio_rate = receiver.demod(iq)

                # Encode audio as base64 float32
                audio_b64 = base64.b64encode(audio.tobytes()).decode('ascii')

                # Compute spectrum
                psd = receiver.compute_psd(iq)

                # Send audio
                await websocket.send(json.dumps({
                    "type": "audio",
                    "samples": audio_b64,
                    "sample_rate": audio_rate,
                    "freq_hz": receiver.freq_hz,
                    "mode": receiver.mode,
                }))

                # Send spectrum (every other frame to save bandwidth)
                await websocket.send(json.dumps({
                    "type": "spectrum",
                    "psd_dbfs": psd[::4],  # Decimate for transfer
                    "center_freq_hz": receiver.freq_hz,
                    "bandwidth_hz": receiver.sample_rate,
                }))

            except Exception as e:
                logger.warning("Stream error: %s", e)
                await asyncio.sleep(0.5)

            # Small yield for other tasks
            await asyncio.sleep(0.01)

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
