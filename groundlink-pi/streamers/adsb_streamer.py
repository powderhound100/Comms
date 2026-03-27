"""ADS-B 1090 MHz streamer — spawns C decoder, relays binary frames over TCP."""

import asyncio
import logging
import struct
import sys
from pathlib import Path

import click

from base_streamer import TcpFrameStreamer

logger = logging.getLogger("adsb-stream")
SCRIPT_DIR = Path(__file__).parent.resolve()
DECODER_DIR = SCRIPT_DIR.parent / "c_decoders"


async def run_streamer(device: int, device_serial: str | None, gain: int,
                       host: str, port: int):
    """Main loop: spawn C decoder, read frames, relay to TCP."""
    streamer = TcpFrameStreamer(host, port, "adsb-1090")

    # Start reconnect loop in background
    reconnect_task = asyncio.create_task(streamer.reconnect_loop())

    binary = str(DECODER_DIR / "groundlink_adsb")
    restart_count = 0
    max_restarts = 10

    while restart_count < max_restarts:
        # Build command
        cmd = [binary, "--gain", str(gain)]
        if device_serial:
            cmd.extend(["--device-serial", device_serial])
        else:
            cmd.extend(["--device", str(device)])

        logger.info("Starting: %s", " ".join(cmd))

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # Log stderr in background
            async def log_stderr():
                while proc.stderr:
                    line = await proc.stderr.readline()
                    if not line:
                        break
                    logger.info("[C] %s", line.decode("utf-8", errors="replace").rstrip())

            stderr_task = asyncio.create_task(log_stderr())

            # Frame relay loop
            frames_sent = 0
            while True:
                header = await proc.stdout.readexactly(5)
                payload_len = struct.unpack('<I', header[1:5])[0]
                payload = await proc.stdout.readexactly(payload_len)

                frame = header + payload
                sent = await streamer.send_frame(frame)

                frames_sent += 1
                if frames_sent <= 3 or frames_sent % 100 == 0:
                    logger.info("Frame #%d: type=%c len=%d sent=%s",
                                frames_sent, chr(header[0]), payload_len, sent)

        except asyncio.IncompleteReadError:
            logger.warning("C process pipe broken")
        except Exception as e:
            logger.error("Streamer error: %s", e)

        restart_count += 1
        logger.info("Restarting decoder (%d/%d)...", restart_count, max_restarts)
        await asyncio.sleep(2.0)

    reconnect_task.cancel()
    await streamer.close()
    logger.error("Max restarts reached, exiting")


@click.command()
@click.option("--device", default=0, help="RTL-SDR device index")
@click.option("--device-serial", default=None, help="RTL-SDR device serial")
@click.option("--gain", default=496, help="Gain in tenths of dB")
@click.option("--host", required=True, help="Windows host IP")
@click.option("--port", default=9001, help="TCP port on Windows host")
def main(device, device_serial, gain, host, port):
    """GROUNDLINK ADS-B 1090 streamer — relay binary frames to Windows host."""
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
                        datefmt="%H:%M:%S")
    asyncio.run(run_streamer(device, device_serial, gain, host, port))


if __name__ == "__main__":
    main()
