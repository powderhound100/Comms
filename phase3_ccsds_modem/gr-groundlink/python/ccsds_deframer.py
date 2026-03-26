"""CCSDS Transfer Frame deframer and validator.

Extracts and validates CCSDS Transfer Frames:
- Verifies CRC-16
- Extracts header fields
- Returns payload data
"""

import struct
from .ccsds_crc import ccsds_crc16
from .ccsds_framer import HEADER_LENGTH, CRC_LENGTH


class CCSDSDeframer:
    """Extract and validate CCSDS Transfer Frames."""

    def deframe(self, frame_bytes: bytes) -> dict:
        """Parse and validate a CCSDS Transfer Frame.

        Args:
            frame_bytes: Complete frame bytes (header + data + CRC).

        Returns:
            Dict with 'valid', 'spacecraft_id', 'vcid', 'counter',
            'data', and 'crc_ok' keys.
        """
        if len(frame_bytes) < HEADER_LENGTH + CRC_LENGTH:
            return {'valid': False, 'error': 'Frame too short'}

        # Verify CRC
        frame_body = frame_bytes[:-CRC_LENGTH]
        received_crc = struct.unpack('>H', frame_bytes[-CRC_LENGTH:])[0]
        computed_crc = ccsds_crc16(frame_body)
        crc_ok = received_crc == computed_crc

        # Parse header
        word0 = struct.unpack('>H', frame_bytes[0:2])[0]
        version = (word0 >> 14) & 0x03
        spacecraft_id = (word0 >> 4) & 0x3FF
        vcid = (word0 >> 1) & 0x07

        counter = struct.unpack('>H', frame_bytes[2:4])[0]
        frame_length = struct.unpack('>H', frame_bytes[4:6])[0] + 1

        # Extract data field
        data = frame_bytes[HEADER_LENGTH:-CRC_LENGTH]

        return {
            'valid': crc_ok,
            'crc_ok': crc_ok,
            'version': version,
            'spacecraft_id': spacecraft_id,
            'vcid': vcid,
            'counter': counter,
            'frame_length': frame_length,
            'data': data,
        }
