"""GROUNDLINK Radio — Live SDR audio receiver with WebSocket streaming.

Separate from the scanner: tunes to a single frequency, demodulates
audio (WFM, NFM, AM), and streams PCM + spectrum to the browser.

Audio is sent as binary WebSocket frames (int16 PCM, 20ms chunks).
Spectrum is sent as JSON text frames (~2 Hz).

Usage:
    python radio_server.py [--port 8770] [--freq 94.9] [--mode wfm]
"""

import asyncio
import json
import logging
import struct
import sys
import os
import threading
from collections import deque
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

# ── Binary frame header ────────────────────────────────────────
# 1 byte: mode (0=wfm, 1=nfm, 2=am)
# 4 bytes: sample_rate (uint32 LE)
# rest: int16 PCM samples (LE)

MODE_IDS = {"wfm": 0, "nfm": 1, "am": 2}


def pack_audio_frame(mode: str, sample_rate: int, audio_int16: np.ndarray) -> bytes:
    """Pack audio into a binary frame: header + int16 PCM."""
    header = struct.pack("<BI", MODE_IDS.get(mode, 0), sample_rate)
    return header + audio_int16.tobytes()


class RadioReceiver:
    """Single-frequency SDR receiver with audio demodulation."""

    def __init__(self):
        self.sdr = None
        self.freq_hz: int = int(94.9e6)
        self.mode: str = "wfm"  # wfm, nfm, am
        self.sample_rate: int = 2_400_000
        self.running: bool = False
        self._clients: set = set()
        # Demod state for de-emphasis filter continuity
        self._deemph_state: float = 0.0

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
        self._deemph_state = 0.0
        if self.sdr:
            self.sdr.center_freq = freq_hz
        logger.info("Tuned: %.3f MHz [%s]", freq_hz / 1e6, mode.upper())

    def audio_rate(self) -> int:
        """Output audio sample rate for current mode."""
        if self.mode == "wfm":
            return 48000
        return 16000

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
        out[0] = self._deemph_state + alpha * (audio[0] - self._deemph_state)
        for i in range(1, len(audio)):
            out[i] = out[i - 1] + alpha * (audio[i] - out[i - 1])
        self._deemph_state = float(out[-1]) if len(out) > 0 else 0.0
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
        out[0] = self._deemph_state + alpha * (audio[0] - self._deemph_state)
        for i in range(1, len(audio)):
            out[i] = out[i - 1] + alpha * (audio[i] - out[i - 1])
        self._deemph_state = float(out[-1]) if len(out) > 0 else 0.0
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


def capture_thread(receiver: RadioReceiver, iq_queue: deque, stop_event: threading.Event):
    """Background thread: continuously read IQ from SDR into a queue.

    Reads small blocks (~20ms worth of samples) to keep latency low.
    """
    # 20ms at 2.4 Msps = 48000 complex samples
    chunk_samples = 48000
    while not stop_event.is_set():
        if not receiver.sdr:
            stop_event.wait(0.5)
            continue
        try:
            iq = receiver.sdr.read_samples(chunk_samples)
            iq_queue.append(iq)
            # Limit queue depth to ~1 second (50 chunks * 20ms)
            while len(iq_queue) > 50:
                iq_queue.popleft()
        except Exception as e:
            logger.warning("SDR read error: %s", e)
            stop_event.wait(0.2)


async def radio_handler(websocket, receiver: RadioReceiver):
    """Handle a single WebSocket client — stream binary audio + JSON spectrum."""
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

    # Start capture thread for this connection
    iq_queue: deque = deque()
    stop_event = threading.Event()
    cap_thread = threading.Thread(
        target=capture_thread,
        args=(receiver, iq_queue, stop_event),
        daemon=True,
    )
    cap_thread.start()

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

        # Stream loop — pull from queue, demod, send binary audio + JSON spectrum
        spectrum_counter = 0
        last_iq_for_spectrum = None

        while True:
            if not iq_queue:
                await asyncio.sleep(0.005)
                continue

            try:
                iq = iq_queue.popleft()
                last_iq_for_spectrum = iq

                # Demod to audio
                audio, audio_rate = receiver.demod(iq)

                if len(audio) == 0:
                    continue

                # Convert float32 → int16 for binary transfer (half the bandwidth)
                audio_int16 = np.clip(audio * 32767, -32768, 32767).astype(np.int16)

                # Send binary frame: header + int16 PCM
                frame = pack_audio_frame(receiver.mode, audio_rate, audio_int16)
                await websocket.send(frame)

                # Send spectrum as JSON text every ~500ms (~25 chunks at 20ms)
                spectrum_counter += 1
                if spectrum_counter >= 25 and last_iq_for_spectrum is not None:
                    spectrum_counter = 0
                    psd = receiver.compute_psd(last_iq_for_spectrum)
                    await websocket.send(json.dumps({
                        "type": "spectrum",
                        "psd_dbfs": psd[::4],
                        "center_freq_hz": receiver.freq_hz,
                        "bandwidth_hz": receiver.sample_rate,
                    }))

                # Pace at real-time (~20ms per chunk)
                chunk_duration = len(audio) / audio_rate
                await asyncio.sleep(chunk_duration * 0.8)  # Slightly fast to keep buffer fed

            except websockets.exceptions.ConnectionClosed:
                break
            except Exception as e:
                logger.warning("Stream error: %s", e)
                await asyncio.sleep(0.1)

    except Exception:
        pass
    finally:
        stop_event.set()
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
        logger.info("Audio: binary int16 PCM, 20ms chunks")
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
