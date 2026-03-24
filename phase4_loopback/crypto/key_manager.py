"""Simplified key management for GROUNDLINK encryption.

In a real spacecraft system, this would be replaced by EKMS (Electronic Key
Management System) with NSA Type 1 algorithms. This implementation uses
filesystem-based key storage for demonstration.
"""

import os
import json
from pathlib import Path
from datetime import datetime, timezone


DEFAULT_KEY_DIR = Path(__file__).parent.parent / 'data' / 'keys'


class KeyManager:
    """Manage AES-256 encryption keys."""

    def __init__(self, key_dir: Path = None):
        self.key_dir = key_dir or DEFAULT_KEY_DIR
        self.key_dir.mkdir(parents=True, exist_ok=True)

    def generate_key(self, key_id: str = None) -> dict:
        """Generate a new AES-256 key.

        Args:
            key_id: Optional identifier. Generated from timestamp if not provided.

        Returns:
            Dict with key_id, key_hex, created_at.
        """
        if key_id is None:
            key_id = datetime.now(timezone.utc).strftime('key_%Y%m%d_%H%M%S')

        key = os.urandom(32)
        record = {
            'key_id': key_id,
            'key_hex': key.hex(),
            'algorithm': 'AES-256-CTR',
            'created_at': datetime.now(timezone.utc).isoformat(),
        }

        # Save to key store
        key_file = self.key_dir / f'{key_id}.json'
        with open(key_file, 'w') as f:
            json.dump(record, f, indent=2)

        return record

    def load_key(self, key_id: str) -> bytes:
        """Load a key by ID.

        Args:
            key_id: Key identifier.

        Returns:
            32-byte key.
        """
        key_file = self.key_dir / f'{key_id}.json'
        if not key_file.exists():
            raise FileNotFoundError(f"Key not found: {key_id}")

        with open(key_file, 'r') as f:
            record = json.load(f)

        return bytes.fromhex(record['key_hex'])

    def list_keys(self) -> list:
        """List all available keys."""
        keys = []
        for f in sorted(self.key_dir.glob('*.json')):
            with open(f, 'r') as fp:
                record = json.load(fp)
            keys.append({
                'key_id': record['key_id'],
                'created_at': record['created_at'],
            })
        return keys
