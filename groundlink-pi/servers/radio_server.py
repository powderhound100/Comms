"""GROUNDLINK Radio — Live SDR audio receiver with WebSocket streaming (Pi).

Thin subprocess manager: spawns groundlink_radio (C demodulator),
reads binary frames from its stdout, and forwards to browser clients.

Architecture:
  - groundlink_radio does ALL DSP (decimate, demod, FFT) in C
  - This server just pipes binary frames to WebSocket clients
  - Audio: binary int16 PCM frames (no base64, no JSON overhead)
  - Spectrum: JSON text frames every ~330ms
  - Retune: kill + restart subprocess with new args

Ported from Windows version for Raspberry Pi (Linux ARM).

Usage:
    python radio_server.py [--port 8770] [--freq 94.9] [--mode wfm]
    python radio_server.py --device-serial GROUNDLINK_RADIO --mode p25 --freq 154.8
"""

import asyncio
import base64
import json
import logging
import os
import struct
import sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import numpy as np
import click

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("radio")

# Paths to executables — Linux ARM, no .exe suffix
SCRIPT_DIR = Path(__file__).parent.resolve()
RADIO_EXE = str(SCRIPT_DIR.parent / "c_decoders" / "groundlink_radio")
DSD_FME_EXE = "/usr/local/bin/dsd-fme"

# Device serial for multi-dongle setups (set via CLI --device-serial)
DEVICE_SERIAL: str | None = None


class RadioProcess:
    """Manages a groundlink_radio subprocess."""

    def __init__(self):
        self.proc: asyncio.subprocess.Process | None = None
        self.dsd_proc: asyncio.subprocess.Process | None = None
        self.freq_hz: int = int(94.9e6)
        self.mode: str = "wfm"
        self.gain: int = 400  # tenths of dB

    async def start(self):
        """Spawn the C demodulator process (and DSD-FME for P25)."""
        if self.proc is not None:
            await self.stop()

        # For P25 mode, use discriminator output from groundlink_radio
        radio_mode = "disc" if self.mode == "p25" else self.mode

        cmd = [
            RADIO_EXE,
            "--freq", str(self.freq_hz),
            "--mode", radio_mode,
            "--gain", str(self.gain),
        ]

        # Pass device serial if configured
        if DEVICE_SERIAL:
            cmd.extend(["--device-serial", DEVICE_SERIAL])

        logger.info("Starting: %s", " ".join(cmd))

        self.proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        # Log stderr in background
        asyncio.create_task(self._log_stderr())
        logger.info("Process started (PID %d)", self.proc.pid)

        # For P25 mode, spawn DSD-FME decoder
        if self.mode == "p25":
            if os.path.isfile(DSD_FME_EXE):
                try:
                    self.dsd_proc = await asyncio.create_subprocess_exec(
                        DSD_FME_EXE, "-i", "-", "-o", "-",
                        stdin=asyncio.subprocess.PIPE,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    asyncio.create_task(self._log_dsd_stderr())
                    logger.info("DSD-FME started (PID %d) — P25 decoding active",
                                self.dsd_proc.pid)
                except Exception as e:
                    logger.warning("Failed to start DSD-FME: %s", e)
                    self.dsd_proc = None
            else:
                logger.warning("dsd-fme not found at %s — P25 decoding unavailable, "
                               "raw discriminator audio will pass through", DSD_FME_EXE)
                self.dsd_proc = None

    async def stop(self):
        """Kill the subprocess(es)."""
        # Stop DSD-FME first
        if self.dsd_proc is not None:
            dsd_pid = self.dsd_proc.pid
            try:
                if self.dsd_proc.stdin:
                    self.dsd_proc.stdin.close()
                self.dsd_proc.terminate()
                try:
                    await asyncio.wait_for(self.dsd_proc.wait(), timeout=2.0)
                except asyncio.TimeoutError:
                    self.dsd_proc.kill()
                    await self.dsd_proc.wait()
            except ProcessLookupError:
                pass
            self.dsd_proc = None
            logger.info("DSD-FME stopped (PID %d)", dsd_pid)

        # Stop groundlink_radio
        if self.proc is None:
            return
        pid = self.proc.pid
        try:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                self.proc.kill()
                await self.proc.wait()
        except ProcessLookupError:
            pass
        self.proc = None
        logger.info("Process stopped (PID %d)", pid)

    async def restart(self, freq_hz: int, mode: str):
        """Retune: kill and restart with new parameters."""
        self.freq_hz = freq_hz
        self.mode = mode
        await self.start()

    async def _log_stderr(self):
        """Forward subprocess stderr to our logger."""
        if self.proc is None or self.proc.stderr is None:
            return
        try:
            while True:
                line = await self.proc.stderr.readline()
                if not line:
                    break
                logger.info("[C] %s", line.decode("utf-8", errors="replace").rstrip())
        except Exception:
            pass

    async def _log_dsd_stderr(self):
        """Forward DSD-FME stderr to our logger."""
        if self.dsd_proc is None or self.dsd_proc.stderr is None:
            return
        try:
            while True:
                line = await self.dsd_proc.stderr.readline()
                if not line:
                    break
                logger.info("[DSD] %s", line.decode("utf-8", errors="replace").rstrip())
        except Exception:
            pass


async def radio_handler(websocket, radio: RadioProcess):
    """Handle a single WebSocket client — stream audio + spectrum."""
    import websockets

    # Parse tune params from URL query string
    path = websocket.request.path if hasattr(websocket, 'request') else ''
    query = {}
    try:
        parsed = urlparse(f"ws://localhost{path}")
        query = parse_qs(parsed.query)
    except Exception:
        pass

    freq = int(query.get("freq", [str(radio.freq_hz)])[0])
    mode = query.get("mode", [radio.mode])[0]

    # Start or restart the C process with requested params
    radio.freq_hz = freq
    radio.mode = mode
    await radio.start()

    logger.info("Client connected: %.3f MHz [%s]", freq / 1e6, mode.upper())

    # DSD-FME audio reader coroutine (P25 mode)
    dsd_task = None

    async def read_dsd_audio():
        """Read decoded PCM from DSD-FME stdout, upsample 8k->48k, send to WS."""
        dsd_audio_count = 0
        chunk_bytes = 1280 * 2  # 1280 samples x 2 bytes/sample (int16) = 160ms at 8kHz
        try:
            while radio.dsd_proc and radio.dsd_proc.stdout:
                raw = await radio.dsd_proc.stdout.read(chunk_bytes)
                if not raw:
                    break
                # Convert int16 -> float32
                int16_arr = np.frombuffer(raw, dtype=np.int16)
                float32_arr = int16_arr.astype(np.float32) / 32768.0

                # Upsample 8k -> 48k (6x linear interpolation)
                n_in = len(float32_arr)
                n_out = n_in * 6
                x_in = np.arange(n_in)
                x_out = np.linspace(0, n_in - 1, n_out)
                upsampled = np.interp(x_out, x_in, float32_arr).astype(np.float32)

                audio_b64 = base64.b64encode(upsampled.tobytes()).decode('ascii')

                dsd_audio_count += 1
                if dsd_audio_count <= 5 or dsd_audio_count % 50 == 0:
                    logger.info("DSD audio #%d: %d->%d samples (8k->48k)",
                                dsd_audio_count, n_in, n_out)

                await websocket.send(json.dumps({
                    "type": "audio",
                    "samples": audio_b64,
                    "sample_rate": 48000,
                    "freq_hz": radio.freq_hz,
                    "mode": radio.mode,
                }))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning("DSD reader error: %s", e)

    # Handle tune commands from the client (background task)
    async def read_commands():
        nonlocal dsd_task
        try:
            async for msg in websocket:
                try:
                    data = json.loads(msg)
                    if data.get("type") == "tune":
                        new_freq = int(data.get("freq_hz", radio.freq_hz))
                        new_mode = data.get("mode", radio.mode)
                        logger.info("Tune command: %.3f MHz [%s]",
                                    new_freq / 1e6, new_mode.upper())
                        # Cancel existing DSD reader if switching modes
                        if dsd_task and not dsd_task.done():
                            dsd_task.cancel()
                            dsd_task = None
                        await radio.restart(new_freq, new_mode)
                        # Start DSD reader if switching to P25
                        if new_mode == "p25" and radio.dsd_proc:
                            dsd_task = asyncio.create_task(read_dsd_audio())
                except (json.JSONDecodeError, ValueError):
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass

    cmd_task = asyncio.create_task(read_commands())

    # Start DSD reader task if initial mode is P25
    if radio.mode == "p25" and radio.dsd_proc:
        dsd_task = asyncio.create_task(read_dsd_audio())

    audio_count = 0
    spectrum_count = 0

    try:
        # Main loop: read binary frames from C process stdout, forward to WS
        while True:
            proc = radio.proc
            if proc is None or proc.stdout is None:
                await asyncio.sleep(0.1)
                continue

            try:
                # Read frame header: type (1 byte) + length (4 bytes)
                header = await proc.stdout.readexactly(5)
                frame_type = header[0:1]
                payload_len = struct.unpack('<I', header[1:5])[0]

                if frame_type == b'A':
                    # Audio frame: sample_rate (4B) + int16[] PCM
                    payload = await proc.stdout.readexactly(payload_len)

                    if radio.mode == "p25" and radio.dsd_proc:
                        # P25: pipe raw PCM (skip sample_rate header) to DSD-FME
                        pcm_data = payload[4:]
                        try:
                            radio.dsd_proc.stdin.write(pcm_data)
                            await radio.dsd_proc.stdin.drain()
                        except (BrokenPipeError, ConnectionResetError):
                            logger.warning("DSD-FME stdin pipe broken")
                        audio_count += 1
                        if audio_count <= 5 or audio_count % 50 == 0:
                            logger.info("Disc->DSD frame #%d: %d bytes",
                                        audio_count, len(pcm_data))
                    else:
                        # Analog mode: convert and send directly to WS
                        sample_rate = struct.unpack('<I', payload[:4])[0]
                        pcm_data = payload[4:]
                        int16_arr = np.frombuffer(pcm_data, dtype=np.int16)
                        float32_arr = (int16_arr.astype(np.float32) / 32768.0)
                        audio_b64 = base64.b64encode(float32_arr.tobytes()).decode('ascii')

                        audio_count += 1
                        if audio_count <= 5 or audio_count % 50 == 0:
                            logger.info("Audio frame #%d: %d samples, rate=%d Hz",
                                        audio_count, len(int16_arr), sample_rate)

                        await websocket.send(json.dumps({
                            "type": "audio",
                            "samples": audio_b64,
                            "sample_rate": sample_rate,
                            "freq_hz": radio.freq_hz,
                            "mode": radio.mode,
                        }))

                elif frame_type == b'S':
                    # Spectrum frame: center_freq (4B) + float32[] bins
                    payload = await proc.stdout.readexactly(payload_len)
                    center_freq = struct.unpack('<I', payload[:4])[0]
                    spectrum_data = payload[4:]
                    n_bins = len(spectrum_data) // 4
                    bins = struct.unpack(f'<{n_bins}f', spectrum_data)

                    spectrum_count += 1
                    if spectrum_count <= 3:
                        logger.info("Spectrum #%d: %d bins, range=[%.1f, %.1f] dBFS",
                                    spectrum_count, n_bins,
                                    min(bins), max(bins))

                    # Send spectrum as JSON text frame
                    await websocket.send(json.dumps({
                        "type": "spectrum",
                        "psd_dbfs": list(bins),
                        "center_freq_hz": center_freq,
                        "bandwidth_hz": 2400000,
                    }))

                else:
                    # Unknown frame type — skip
                    logger.warning("Unknown frame type: 0x%02x", frame_type[0])
                    await proc.stdout.readexactly(payload_len)

            except asyncio.IncompleteReadError:
                # Process exited or pipe broken — restart if still connected
                logger.warning("C process pipe broken, restarting...")
                await asyncio.sleep(0.5)
                if radio.proc is None or radio.proc.returncode is not None:
                    await radio.start()
                    # Restart DSD reader if P25
                    if radio.mode == "p25" and radio.dsd_proc:
                        if dsd_task and not dsd_task.done():
                            dsd_task.cancel()
                        dsd_task = asyncio.create_task(read_dsd_audio())

            except websockets.exceptions.ConnectionClosed:
                break

    except Exception as e:
        logger.warning("Handler error: %s", e)
    finally:
        if dsd_task and not dsd_task.done():
            dsd_task.cancel()
        cmd_task.cancel()
        await radio.stop()
        logger.info("Client disconnected")


@click.command()
@click.option("--port", default=8770, help="WebSocket port")
@click.option("--freq", default=94.9, help="Initial frequency (MHz)")
@click.option("--mode", default="wfm", type=click.Choice(["wfm", "nfm", "am", "p25"]),
              help="Demod mode")
@click.option("--device-serial", default=None, help="RTL-SDR device serial (for multi-dongle)")
def main(port, freq, mode, device_serial):
    """GROUNDLINK Radio — Live SDR audio receiver (C backend, Pi)."""
    import websockets

    global DEVICE_SERIAL
    DEVICE_SERIAL = device_serial

    radio = RadioProcess()
    radio.freq_hz = int(freq * 1e6)
    radio.mode = mode

    # Verify the C executable exists
    if not os.path.isfile(RADIO_EXE):
        logger.error("C demodulator not found: %s", RADIO_EXE)
        logger.error("Run: cd c_decoders && make groundlink_radio")
        sys.exit(1)

    async def serve():
        logger.info("=" * 50)
        logger.info("GROUNDLINK Radio (C backend, Pi)")
        logger.info("Frequency: %.3f MHz [%s]", freq, mode.upper())
        logger.info("WebSocket: ws://0.0.0.0:%d", port)
        logger.info("Audio: binary int16 PCM (no base64)")
        logger.info("Demodulator: %s", RADIO_EXE)
        if DEVICE_SERIAL:
            logger.info("Device serial: %s", DEVICE_SERIAL)
        logger.info("=" * 50)

        async with websockets.serve(
            lambda ws: radio_handler(ws, radio),
            "0.0.0.0", port,
        ):
            try:
                await asyncio.Future()  # Run forever
            except asyncio.CancelledError:
                pass
            finally:
                await radio.stop()

    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        logger.info("Radio shutting down")


if __name__ == "__main__":
    main()
