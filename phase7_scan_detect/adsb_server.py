"""GROUNDLINK ADS-B — Live aircraft tracker with WebSocket streaming.

Thin subprocess manager: spawns groundlink_adsb.exe (C decoder),
reads binary frames from its stdout, and forwards to browser clients.

Architecture:
  - groundlink_adsb.exe does ALL DSP (magnitude, preamble, CRC, decode) in C
  - This server just pipes binary frames to WebSocket clients
  - Decoded aircraft: JSON text frames (~1/sec)
  - Spectrum: JSON text frames (~every 1.3s)
  - Raw messages: optional hex relay for interop

Usage:
    python adsb_server.py [--port 8771] [--gain 496] [--test]
"""

import asyncio
import json
import logging
import os
import struct
import sys
from pathlib import Path

import click

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("adsb")

# Path to the C decoder executable (same directory as this script)
SCRIPT_DIR = Path(__file__).parent.resolve()
ADSB_EXE = str(SCRIPT_DIR / "groundlink_adsb.exe")

# RTL-SDR DLL directory — needed at runtime
RTLSDR_DIR = r"D:\tools\rtl-sdr\x64"


class AdsbProcess:
    """Manages a groundlink_adsb.exe subprocess."""

    def __init__(self, gain: int = 496, device: int = 0, test: bool = False):
        self.proc: asyncio.subprocess.Process | None = None
        self.gain = gain
        self.device = device
        self.test = test

    async def start(self):
        """Spawn the C decoder process."""
        if self.proc is not None:
            await self.stop()

        # Ensure rtlsdr.dll is findable
        env = os.environ.copy()
        path = env.get("PATH", "")
        if RTLSDR_DIR not in path:
            env["PATH"] = RTLSDR_DIR + ";" + path

        cmd = [
            ADSB_EXE,
            "--gain", str(self.gain),
            "--device", str(self.device),
        ]
        if self.test:
            cmd.append("--test")

        logger.info("Starting: %s", " ".join(cmd))

        self.proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        asyncio.create_task(self._log_stderr())
        logger.info("Process started (PID %d)", self.proc.pid)

    async def stop(self):
        """Kill the subprocess."""
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


# Connected WebSocket clients
clients: set = set()


async def broadcast(message: str):
    """Send a message to all connected clients."""
    if not clients:
        return
    dead = set()
    for ws in clients:
        try:
            await ws.send(message)
        except Exception:
            dead.add(ws)
    clients.difference_update(dead)


async def frame_reader(adsb: AdsbProcess):
    """Read binary frames from the C process and broadcast to clients."""
    aircraft_count = 0
    spectrum_count = 0
    msg_count = 0

    while True:
        proc = adsb.proc
        if proc is None or proc.stdout is None:
            await asyncio.sleep(0.5)
            continue

        try:
            # Read frame header: type (1 byte) + length (4 bytes)
            header = await proc.stdout.readexactly(5)
            frame_type = header[0:1]
            payload_len = struct.unpack('<I', header[1:5])[0]
            payload = await proc.stdout.readexactly(payload_len)

            if frame_type == b'D':
                # Decoded aircraft JSON
                try:
                    data = json.loads(payload.decode('utf-8'))
                    aircraft_count += 1
                    if aircraft_count <= 3 or aircraft_count % 30 == 0:
                        ac_count = data.get('aircraft_count', 0)
                        msg_rate = data.get('msg_rate', 0)
                        logger.info("Aircraft report #%d: %d tracked, %.1f msg/s",
                                    aircraft_count, ac_count, msg_rate)

                    await broadcast(json.dumps({
                        "type": "aircraft",
                        **data,
                    }))
                except (json.JSONDecodeError, UnicodeDecodeError) as e:
                    logger.warning("Bad JSON in D frame: %s", e)

            elif frame_type == b'S':
                # Spectrum frame: center_freq (4B) + float32[] bins
                center_freq = struct.unpack('<I', payload[:4])[0]
                spectrum_data = payload[4:]
                n_bins = len(spectrum_data) // 4
                bins = struct.unpack(f'<{n_bins}f', spectrum_data)

                spectrum_count += 1
                if spectrum_count <= 3:
                    logger.info("Spectrum #%d: %d bins, range=[%.1f, %.1f] dBFS",
                                spectrum_count, n_bins, min(bins), max(bins))

                await broadcast(json.dumps({
                    "type": "spectrum",
                    "psd_dbfs": list(bins),
                    "center_freq_hz": center_freq,
                    "bandwidth_hz": SAMPLE_RATE,
                }))

            elif frame_type == b'M':
                # Raw hex message
                hex_str = payload.decode('ascii', errors='replace')
                msg_count += 1
                if msg_count <= 5 or msg_count % 100 == 0:
                    logger.info("Raw msg #%d: %s", msg_count, hex_str)

                await broadcast(json.dumps({
                    "type": "raw_msg",
                    "hex": hex_str,
                }))

            else:
                logger.warning("Unknown frame type: 0x%02x", frame_type[0])

        except asyncio.IncompleteReadError:
            logger.warning("C process pipe broken, restarting...")
            await asyncio.sleep(1.0)
            if adsb.proc is None or adsb.proc.returncode is not None:
                await adsb.start()

        except Exception as e:
            logger.warning("Frame reader error: %s", e)
            await asyncio.sleep(0.5)


SAMPLE_RATE = 2000000


async def ws_handler(websocket):
    """Handle a WebSocket client connection."""
    clients.add(websocket)
    logger.info("Client connected (%d total)", len(clients))
    try:
        async for msg in websocket:
            pass  # No commands needed (always 1090 MHz)
    except Exception:
        pass
    finally:
        clients.discard(websocket)
        logger.info("Client disconnected (%d remaining)", len(clients))


@click.command()
@click.option("--port", default=8771, help="WebSocket port")
@click.option("--gain", default=496, help="RTL-SDR gain in tenths of dB")
@click.option("--device", default=0, help="RTL-SDR device index")
@click.option("--test", is_flag=True, help="Test mode (synthetic messages)")
def main(port, gain, device, test):
    """GROUNDLINK ADS-B — Live aircraft tracker (C backend)."""
    import websockets

    # Verify the C executable exists
    if not os.path.isfile(ADSB_EXE):
        logger.error("C decoder not found: %s", ADSB_EXE)
        logger.error("Run build_adsb.bat first to compile groundlink_adsb.exe")
        sys.exit(1)

    adsb = AdsbProcess(gain=gain, device=device, test=test)

    async def serve():
        logger.info("=" * 50)
        logger.info("GROUNDLINK ADS-B Decoder (C backend)")
        logger.info("Frequency: 1090 MHz")
        logger.info("WebSocket: ws://0.0.0.0:%d", port)
        logger.info("Decoder: %s", ADSB_EXE)
        if test:
            logger.info("MODE: Test (synthetic messages)")
        logger.info("=" * 50)

        await adsb.start()

        # Start frame reader in background
        reader_task = asyncio.create_task(frame_reader(adsb))

        async with websockets.serve(ws_handler, "0.0.0.0", port):
            try:
                await asyncio.Future()  # Run forever
            except asyncio.CancelledError:
                pass
            finally:
                reader_task.cancel()
                await adsb.stop()

    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        logger.info("ADS-B shutting down")


if __name__ == "__main__":
    main()
