"""Async WebSocket server for streaming scan data to the dashboard."""

import asyncio
import json
import logging
from datetime import datetime, timezone

import numpy as np

logger = logging.getLogger(__name__)


class ScanWebSocketServer:
    """WebSocket server that broadcasts spectrum and detection events."""

    def __init__(self, host: str = "0.0.0.0", port: int = 8765, spectrum_decimation: int = 4):
        self.host = host
        self.port = port
        self.spectrum_decimation = spectrum_decimation
        self._clients: set = set()
        self._spectrum_counter = 0
        self._server = None

    async def start(self) -> None:
        try:
            import websockets
            self._server = await websockets.serve(
                self._handler, self.host, self.port
            )
            logger.info("WebSocket server listening on ws://%s:%d", self.host, self.port)
        except ImportError:
            logger.warning("websockets package not installed — WS server disabled")

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            logger.info("WebSocket server stopped")

    async def _handler(self, websocket, path=None) -> None:
        self._clients.add(websocket)
        logger.info("Client connected (%d total)", len(self._clients))
        try:
            async for message in websocket:
                # Clients can send config updates or commands
                try:
                    data = json.loads(message)
                    logger.debug("Received from client: %s", data.get("type"))
                except json.JSONDecodeError:
                    pass
        except Exception:
            pass
        finally:
            self._clients.discard(websocket)
            logger.info("Client disconnected (%d remaining)", len(self._clients))

    async def broadcast_spectrum(
        self, center_freq_hz: float, psd_dbfs: np.ndarray, bandwidth_hz: float
    ) -> None:
        """Send spectrum data (decimated) to all connected clients."""
        self._spectrum_counter += 1
        if self._spectrum_counter % self.spectrum_decimation != 0:
            return

        if not self._clients:
            return

        message = json.dumps({
            "type": "spectrum",
            "center_freq_hz": center_freq_hz,
            "bandwidth_hz": bandwidth_hz,
            "psd_dbfs": psd_dbfs.tolist(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        await self._broadcast(message)

    async def broadcast_detection(self, detection_data: dict) -> None:
        """Send a detection event to all connected clients."""
        if not self._clients:
            return

        message = json.dumps({
            "type": "detection",
            **detection_data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        await self._broadcast(message)

    async def broadcast_status(self, status: str, **kwargs) -> None:
        """Send scanner status update to all clients."""
        if not self._clients:
            return

        message = json.dumps({
            "type": "status",
            "status": status,
            **kwargs,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        await self._broadcast(message)

    async def _broadcast(self, message: str) -> None:
        """Send message to all connected clients, removing dead ones."""
        if not self._clients:
            return

        import websockets
        dead = set()
        for client in self._clients:
            try:
                await client.send(message)
            except websockets.exceptions.ConnectionClosed:
                dead.add(client)
            except Exception:
                dead.add(client)

        self._clients -= dead
