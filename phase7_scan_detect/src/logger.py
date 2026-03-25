"""SQLite persistence for scan sessions and signal detections."""

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass, field, asdict
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class DetectionRecord:
    """A fully processed detection ready for storage."""
    scan_id: str
    detected_at: str
    frequency_hz: float
    bandwidth_hz: float
    snr_db: float
    noise_floor_dbfs: float
    peak_power_dbfs: float
    modulation: str | None = None
    confidence: float | None = None
    model_used: str | None = None
    inference_ms: float | None = None
    known_signal: str | None = None
    demod_type: str | None = None
    demod_preview: str | None = None
    id: int | None = None


class ScanLogger:
    """SQLite-backed logger for scan sessions and detections."""

    def __init__(self, db_path: str = "db/scanner.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row
        # Enable WAL for better concurrent read performance
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._create_tables()

    def _create_tables(self) -> None:
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS scans (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id     TEXT NOT NULL UNIQUE,
                started_at  TEXT NOT NULL,
                stopped_at  TEXT,
                config_json TEXT NOT NULL,
                status      TEXT NOT NULL DEFAULT 'running'
            );

            CREATE TABLE IF NOT EXISTS detections (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id         TEXT NOT NULL,
                detected_at     TEXT NOT NULL,
                frequency_hz    REAL NOT NULL,
                bandwidth_hz    REAL NOT NULL,
                snr_db          REAL NOT NULL,
                noise_floor_dbfs REAL NOT NULL,
                peak_power_dbfs REAL NOT NULL,
                modulation      TEXT,
                confidence      REAL,
                model_used      TEXT,
                inference_ms    REAL,
                known_signal    TEXT,
                demod_type      TEXT,
                demod_preview   TEXT,
                FOREIGN KEY (scan_id) REFERENCES scans(scan_id)
            );

            CREATE INDEX IF NOT EXISTS idx_detections_scan_id
                ON detections(scan_id);
            CREATE INDEX IF NOT EXISTS idx_detections_frequency
                ON detections(frequency_hz);
            CREATE INDEX IF NOT EXISTS idx_detections_time
                ON detections(detected_at);
            CREATE INDEX IF NOT EXISTS idx_detections_modulation
                ON detections(modulation);
        """)
        self.conn.commit()

    def start_scan(self, config: dict) -> str:
        """Create a new scan session. Returns scan_id."""
        scan_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            "INSERT INTO scans (scan_id, started_at, config_json, status) VALUES (?, ?, ?, ?)",
            (scan_id, now, json.dumps(config), "running"),
        )
        self.conn.commit()
        logger.info("Scan started: %s", scan_id)
        return scan_id

    def stop_scan(self, scan_id: str) -> None:
        """Mark a scan session as stopped."""
        now = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            "UPDATE scans SET stopped_at = ?, status = 'stopped' WHERE scan_id = ?",
            (now, scan_id),
        )
        self.conn.commit()
        logger.info("Scan stopped: %s", scan_id)

    def log_detection(self, record: DetectionRecord) -> int:
        """Insert a detection record. Returns row ID."""
        cur = self.conn.execute(
            """INSERT INTO detections
               (scan_id, detected_at, frequency_hz, bandwidth_hz, snr_db,
                noise_floor_dbfs, peak_power_dbfs, modulation, confidence,
                model_used, inference_ms, known_signal, demod_type, demod_preview)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record.scan_id, record.detected_at, record.frequency_hz,
                record.bandwidth_hz, record.snr_db, record.noise_floor_dbfs,
                record.peak_power_dbfs, record.modulation, record.confidence,
                record.model_used, record.inference_ms, record.known_signal,
                record.demod_type, record.demod_preview,
            ),
        )
        self.conn.commit()
        return cur.lastrowid

    def query_detections(
        self,
        scan_id: str | None = None,
        min_freq: float | None = None,
        max_freq: float | None = None,
        modulation: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """Query detections with filters."""
        conditions = []
        params: list = []

        if scan_id:
            conditions.append("scan_id = ?")
            params.append(scan_id)
        if min_freq is not None:
            conditions.append("frequency_hz >= ?")
            params.append(min_freq)
        if max_freq is not None:
            conditions.append("frequency_hz <= ?")
            params.append(max_freq)
        if modulation:
            conditions.append("modulation = ?")
            params.append(modulation)

        where = " AND ".join(conditions) if conditions else "1=1"
        params.extend([limit, offset])

        rows = self.conn.execute(
            f"SELECT * FROM detections WHERE {where} ORDER BY detected_at DESC LIMIT ? OFFSET ?",
            params,
        ).fetchall()

        return [dict(row) for row in rows]

    def get_scan_sessions(self, limit: int = 20) -> list[dict]:
        """List recent scan sessions."""
        rows = self.conn.execute(
            "SELECT * FROM scans ORDER BY started_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_detection_count(self, scan_id: str | None = None) -> int:
        """Count detections, optionally filtered by scan."""
        if scan_id:
            row = self.conn.execute(
                "SELECT COUNT(*) FROM detections WHERE scan_id = ?", (scan_id,)
            ).fetchone()
        else:
            row = self.conn.execute("SELECT COUNT(*) FROM detections").fetchone()
        return row[0]

    def close(self) -> None:
        self.conn.close()
