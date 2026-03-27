"""Base TCP frame streamer — reconnecting client that sends binary frames to Windows host."""

import asyncio
import logging
import time

logger = logging.getLogger(__name__)


class TcpFrameStreamer:
    """TCP client with automatic reconnection and exponential backoff."""

    def __init__(self, host: str, port: int, name: str = "streamer"):
        self.host = host
        self.port = port
        self.name = name
        self.reader: asyncio.StreamReader | None = None
        self.writer: asyncio.StreamWriter | None = None
        self.connected = False
        self._backoff = 1.0
        self._bytes_sent = 0

    async def connect(self):
        """Open TCP connection to the Windows host."""
        try:
            self.reader, self.writer = await asyncio.open_connection(
                self.host, self.port)
            self.connected = True
            self._backoff = 1.0
            logger.info("[%s] Connected to %s:%d", self.name, self.host, self.port)
        except (ConnectionRefusedError, OSError) as e:
            self.connected = False
            logger.warning("[%s] Connection failed: %s", self.name, e)

    async def send_frame(self, data: bytes):
        """Send raw bytes. Returns True on success, False on failure."""
        if not self.connected or self.writer is None:
            return False
        try:
            self.writer.write(data)
            await self.writer.drain()
            self._bytes_sent += len(data)
            return True
        except (BrokenPipeError, ConnectionResetError, OSError):
            self.connected = False
            if self.writer:
                self.writer.close()
            self.writer = None
            return False

    async def reconnect_loop(self):
        """Keep trying to connect with exponential backoff (1s, 2s, 4s, 8s, max 30s)."""
        while True:
            if not self.connected:
                await self.connect()
                if not self.connected:
                    logger.info("[%s] Retrying in %.0fs...", self.name, self._backoff)
                    await asyncio.sleep(self._backoff)
                    self._backoff = min(self._backoff * 2, 30.0)
                    continue
            await asyncio.sleep(1.0)

    async def close(self):
        """Close the connection."""
        self.connected = False
        if self.writer:
            self.writer.close()
            try:
                await self.writer.wait_closed()
            except Exception:
                pass
        self.writer = None
