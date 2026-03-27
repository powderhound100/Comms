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
import sqlite3
import struct
import sys
import time
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

# Aircraft log database
DB_PATH = SCRIPT_DIR / "db" / "aircraft.db"


class AircraftLog:
    """SQLite logger for ADS-B aircraft sightings with deduplication."""

    def __init__(self, db_path: Path = DB_PATH):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(db_path))
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._create_tables()
        logger.info("Aircraft log: %s", db_path)

    def _create_tables(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS aircraft (
                icao        TEXT PRIMARY KEY,
                callsign    TEXT,
                first_seen  TEXT NOT NULL,
                last_seen   TEXT NOT NULL,
                total_msgs  INTEGER DEFAULT 0,
                sessions    INTEGER DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS sightings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                icao        TEXT NOT NULL,
                callsign    TEXT,
                lat         REAL,
                lon         REAL,
                alt_ft      INTEGER,
                gs_kt       REAL,
                hdg         REAL,
                vr_fpm      INTEGER,
                on_ground   INTEGER,
                ts          TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sightings_icao ON sightings(icao);
            CREATE INDEX IF NOT EXISTS idx_sightings_ts   ON sightings(ts);
        """)
        self.conn.commit()

        # Migration: add source column for dual-frequency support
        try:
            self.conn.execute("ALTER TABLE sightings ADD COLUMN source TEXT DEFAULT '1090'")
            self.conn.commit()
        except Exception:
            pass  # Column already exists

    def log_aircraft(self, ac_list: list[dict], source: str = "1090"):
        """Log a batch of aircraft from one 'D' frame. Deduplicates by
        only inserting a sighting if position or callsign changed since
        the last sighting for that ICAO."""
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        for ac in ac_list:
            icao = ac.get("icao", "").upper()
            if not icao:
                continue

            callsign = ac.get("callsign") or None
            lat = ac.get("lat")
            lon = ac.get("lon")
            alt = ac.get("alt_ft")
            gs = ac.get("gs_kt")
            hdg = ac.get("hdg")
            vr = ac.get("vr_fpm")
            on_gnd = 1 if ac.get("on_ground") else 0
            msgs = ac.get("msgs", 0)

            # Upsert aircraft master record
            row = self.conn.execute(
                "SELECT callsign, total_msgs FROM aircraft WHERE icao = ?",
                (icao,),
            ).fetchone()

            if row is None:
                self.conn.execute(
                    "INSERT INTO aircraft (icao, callsign, first_seen, last_seen, total_msgs, sessions) "
                    "VALUES (?, ?, ?, ?, ?, 1)",
                    (icao, callsign, now, now, msgs),
                )
            else:
                cs = callsign if callsign else row[0]
                self.conn.execute(
                    "UPDATE aircraft SET callsign = ?, last_seen = ?, total_msgs = total_msgs + ? "
                    "WHERE icao = ?",
                    (cs, now, max(0, msgs - row[1]), icao),
                )

            # Deduplicate sightings: skip if same position OR <10s since last
            if lat is not None and lon is not None:
                last = self.conn.execute(
                    "SELECT lat, lon, callsign, ts FROM sightings "
                    "WHERE icao = ? ORDER BY id DESC LIMIT 1",
                    (icao,),
                ).fetchone()

                if last:
                    same_pos = (last[0] == lat and last[1] == lon and last[2] == callsign)
                    try:
                        elapsed = time.time() - time.mktime(time.strptime(last[3], "%Y-%m-%dT%H:%M:%SZ"))
                    except (ValueError, TypeError):
                        elapsed = 999
                    if same_pos or elapsed < 10:
                        continue  # dedup: same position OR too recent

                self.conn.execute(
                    "INSERT INTO sightings (icao, callsign, lat, lon, alt_ft, gs_kt, hdg, vr_fpm, on_ground, ts, source) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (icao, callsign, lat, lon, alt, gs, hdg, vr, on_gnd, now, source),
                )

        self.conn.commit()

    def stats(self) -> dict:
        total = self.conn.execute("SELECT COUNT(*) FROM aircraft").fetchone()[0]
        today = time.strftime("%Y-%m-%d", time.gmtime())
        today_count = self.conn.execute(
            "SELECT COUNT(DISTINCT icao) FROM sightings WHERE ts >= ?",
            (today + "T00:00:00Z",),
        ).fetchone()[0]
        sightings = self.conn.execute("SELECT COUNT(*) FROM sightings").fetchone()[0]
        return {"unique_aircraft": total, "today": today_count, "total_sightings": sightings}

    def close(self):
        self.conn.close()


async def pruner_loop(db_path: Path, interval_s: int = 3600, max_age_days: int = 7):
    """Background task: delete sightings older than max_age_days in batches."""
    await asyncio.sleep(60)  # initial delay
    while True:
        try:
            cutoff = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ",
                time.gmtime(time.time() - max_age_days * 86400),
            )
            conn = sqlite3.connect(str(db_path))
            total_deleted = 0
            while True:
                deleted = conn.execute(
                    "DELETE FROM sightings WHERE id IN ("
                    "  SELECT id FROM sightings WHERE ts < ? LIMIT 5000"
                    ")",
                    (cutoff,),
                ).rowcount
                conn.commit()
                total_deleted += deleted
                if deleted < 5000:
                    break
            conn.close()
            if total_deleted > 0:
                logger.info("Pruner: deleted %d sightings older than %s", total_deleted, cutoff)
        except Exception as e:
            logger.warning("Pruner error: %s", e)
        await asyncio.sleep(interval_s)


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


class RemoteAdsbSource:
    """Accepts TCP connection from Pi streamer, provides frame reader interface."""

    def __init__(self, listen_port: int, source_label: str):
        self.listen_port = listen_port
        self.source_label = source_label  # "1090" or "978"
        self.reader: asyncio.StreamReader | None = None
        self.writer: asyncio.StreamWriter | None = None
        self.connected = False
        self._server = None

    async def start(self):
        """Start TCP server, wait for Pi to connect."""
        self._server = await asyncio.start_server(
            self._on_connect, '0.0.0.0', self.listen_port)
        logger.info("Listening for %s stream on port %d",
                     self.source_label, self.listen_port)

    async def _on_connect(self, reader, writer):
        """Called when Pi streamer connects."""
        self.reader = reader
        self.writer = writer
        self.connected = True
        peer = writer.get_extra_info('peername')
        logger.info("Pi connected for %s from %s", self.source_label, peer)

    async def stop(self):
        if self._server:
            self._server.close()
        if self.writer:
            self.writer.close()
        self.connected = False


class DualAdsbServer:
    """Accepts streams from both 1090 and 978 MHz, merges into one WebSocket output."""

    def __init__(self, port_1090: int = 9001, port_978: int = 9002):
        self.source_1090 = RemoteAdsbSource(port_1090, "1090")
        self.source_978 = RemoteAdsbSource(port_978, "978")
        self.source_stats = {
            "1090": {"connected": False, "msg_rate": 0, "aircraft_count": 0},
            "978": {"connected": False, "msg_rate": 0, "aircraft_count": 0},
        }

    async def start(self):
        await self.source_1090.start()
        await self.source_978.start()

    async def stop(self):
        await self.source_1090.stop()
        await self.source_978.stop()


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


async def frame_reader(adsb: AdsbProcess, ac_log: AircraftLog):
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

                    # Log to database
                    ac_list = data.get("aircraft", [])
                    if ac_list:
                        try:
                            ac_log.log_aircraft(ac_list)
                        except Exception as e:
                            logger.warning("DB log error: %s", e)

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
UAT_SAMPLE_RATE = 2083334


async def remote_frame_reader(source: RemoteAdsbSource, ac_log: AircraftLog,
                               dual_server: DualAdsbServer):
    """Read binary frames from a remote TCP source (Pi streamer) and broadcast."""
    source_label = source.source_label
    bandwidth = SAMPLE_RATE if source_label == "1090" else UAT_SAMPLE_RATE
    aircraft_count = 0
    spectrum_count = 0
    msg_count = 0

    while True:
        if not source.connected or source.reader is None:
            await asyncio.sleep(0.5)
            dual_server.source_stats[source_label]["connected"] = False
            continue

        dual_server.source_stats[source_label]["connected"] = True

        try:
            # Read frame header: type (1 byte) + length (4 bytes)
            header = await source.reader.readexactly(5)
            frame_type = header[0:1]
            payload_len = struct.unpack('<I', header[1:5])[0]
            payload = await source.reader.readexactly(payload_len)

            if frame_type == b'D':
                # Decoded aircraft JSON
                try:
                    data = json.loads(payload.decode('utf-8'))
                    aircraft_count += 1
                    ac_count = data.get('aircraft_count', 0)
                    msg_rate = data.get('msg_rate', 0)

                    # Update source stats
                    dual_server.source_stats[source_label]["msg_rate"] = msg_rate
                    dual_server.source_stats[source_label]["aircraft_count"] = ac_count

                    if aircraft_count <= 3 or aircraft_count % 30 == 0:
                        logger.info("[%s] Aircraft report #%d: %d tracked, %.1f msg/s",
                                    source_label, aircraft_count, ac_count, msg_rate)

                    # Tag each aircraft with source frequency
                    ac_list = data.get("aircraft", [])
                    for ac in ac_list:
                        ac["source"] = source_label

                    # Log to database
                    if ac_list:
                        try:
                            ac_log.log_aircraft(ac_list, source=source_label)
                        except Exception as e:
                            logger.warning("[%s] DB log error: %s", source_label, e)

                    await broadcast(json.dumps({
                        "type": "aircraft",
                        "source": source_label,
                        "sources": dual_server.source_stats,
                        **data,
                    }))
                except (json.JSONDecodeError, UnicodeDecodeError) as e:
                    logger.warning("[%s] Bad JSON in D frame: %s", source_label, e)

            elif frame_type == b'S':
                # Spectrum frame: center_freq (4B) + float32[] bins
                center_freq = struct.unpack('<I', payload[:4])[0]
                spectrum_data = payload[4:]
                n_bins = len(spectrum_data) // 4
                bins = struct.unpack(f'<{n_bins}f', spectrum_data)

                spectrum_count += 1
                if spectrum_count <= 3:
                    logger.info("[%s] Spectrum #%d: %d bins, range=[%.1f, %.1f] dBFS",
                                source_label, spectrum_count, n_bins, min(bins), max(bins))

                await broadcast(json.dumps({
                    "type": "spectrum",
                    "source": source_label,
                    "psd_dbfs": list(bins),
                    "center_freq_hz": center_freq,
                    "bandwidth_hz": bandwidth,
                }))

            elif frame_type == b'M':
                # Raw hex message
                hex_str = payload.decode('ascii', errors='replace')
                msg_count += 1
                if msg_count <= 5 or msg_count % 100 == 0:
                    logger.info("[%s] Raw msg #%d: %s", source_label, msg_count, hex_str)

                await broadcast(json.dumps({
                    "type": "raw_msg",
                    "source": source_label,
                    "hex": hex_str,
                }))

            else:
                logger.warning("[%s] Unknown frame type: 0x%02x", source_label, frame_type[0])

        except asyncio.IncompleteReadError:
            logger.warning("[%s] TCP stream broken, waiting for reconnect...",
                           source_label)
            source.connected = False
            source.reader = None
            source.writer = None
            dual_server.source_stats[source_label]["connected"] = False
            await asyncio.sleep(1.0)

        except Exception as e:
            logger.warning("[%s] Frame reader error: %s", source_label, e)
            await asyncio.sleep(0.5)


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
@click.option("--remote", is_flag=True, help="Accept TCP streams from Pi instead of local subprocess")
@click.option("--listen-port-1090", default=9001, help="TCP port for 1090 stream (remote mode)")
@click.option("--listen-port-978", default=9002, help="TCP port for 978 stream (remote mode)")
def main(port, gain, device, test, remote, listen_port_1090, listen_port_978):
    """GROUNDLINK ADS-B — Live aircraft tracker (C backend)."""
    import websockets

    if remote:
        # Remote mode: accept TCP streams from Raspberry Pi
        dual = DualAdsbServer(port_1090=listen_port_1090, port_978=listen_port_978)

        async def serve():
            logger.info("=" * 50)
            logger.info("GROUNDLINK ADS-B Decoder (REMOTE / Dual-Freq)")
            logger.info("Frequencies: 1090 MHz + 978 MHz (UAT)")
            logger.info("TCP listen: 1090 on port %d, 978 on port %d",
                        listen_port_1090, listen_port_978)
            logger.info("WebSocket: ws://0.0.0.0:%d", port)
            logger.info("=" * 50)

            ac_log = AircraftLog()
            await dual.start()

            # Start frame readers for both sources and pruner in background
            reader_1090 = asyncio.create_task(
                remote_frame_reader(dual.source_1090, ac_log, dual))
            reader_978 = asyncio.create_task(
                remote_frame_reader(dual.source_978, ac_log, dual))
            pruner_task = asyncio.create_task(pruner_loop(DB_PATH))

            async with websockets.serve(ws_handler, "0.0.0.0", port):
                try:
                    await asyncio.Future()  # Run forever
                except asyncio.CancelledError:
                    pass
                finally:
                    reader_1090.cancel()
                    reader_978.cancel()
                    pruner_task.cancel()
                    await dual.stop()
                    stats = ac_log.stats()
                    logger.info("Session stats: %d unique aircraft, %d sightings",
                                stats["unique_aircraft"], stats["total_sightings"])
                    ac_log.close()

        try:
            asyncio.run(serve())
        except KeyboardInterrupt:
            logger.info("ADS-B shutting down")
        return

    # Local mode: spawn C decoder subprocess
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

        ac_log = AircraftLog()
        await adsb.start()

        # Start frame reader and pruner in background
        reader_task = asyncio.create_task(frame_reader(adsb, ac_log))
        pruner_task = asyncio.create_task(pruner_loop(DB_PATH))

        async with websockets.serve(ws_handler, "0.0.0.0", port):
            try:
                await asyncio.Future()  # Run forever
            except asyncio.CancelledError:
                pass
            finally:
                reader_task.cancel()
                pruner_task.cancel()
                await adsb.stop()
                stats = ac_log.stats()
                logger.info("Session stats: %d unique aircraft, %d sightings",
                            stats["unique_aircraft"], stats["total_sightings"])
                ac_log.close()

    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        logger.info("ADS-B shutting down")


if __name__ == "__main__":
    main()
