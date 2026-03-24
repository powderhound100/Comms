"""CCSDS Transfer Frame assembler.

Assembles CCSDS Transfer Frames per CCSDS 132.0-B:
- 6-byte primary header (version, SCID, VCID, counter, length)
- Variable-length data field
- 2-byte CRC-16 (CCITT)

Frame structure:
    [Header 48 bits][Data Field][CRC 16 bits]
"""

import struct
from .ccsds_crc import ccsds_crc16


# Default CCSDS Transfer Frame parameters
DEFAULT_FRAME_LENGTH = 1115  # bytes (8920 bits)
HEADER_LENGTH = 6  # bytes
CRC_LENGTH = 2  # bytes
ASM = bytes([0x1A, 0xCF, 0xFC, 0x1D])  # Attached Sync Marker


class CCSDSFramer:
    """Assemble CCSDS Transfer Frames from data bytes."""

    def __init__(self, spacecraft_id: int = 0x1A,
                 virtual_channel_id: int = 0,
                 frame_length: int = DEFAULT_FRAME_LENGTH):
        """Initialize framer.

        Args:
            spacecraft_id: 10-bit Spacecraft ID.
            virtual_channel_id: 3-bit Virtual Channel ID.
            frame_length: Total frame length in bytes (including header + CRC).
        """
        self.spacecraft_id = spacecraft_id & 0x3FF
        self.vcid = virtual_channel_id & 0x07
        self.frame_length = frame_length
        self.data_length = frame_length - HEADER_LENGTH - CRC_LENGTH
        self.frame_counter = 0

    def make_frame(self, data: bytes) -> bytes:
        """Create a complete CCSDS Transfer Frame.

        Args:
            data: Payload data bytes. Will be padded or truncated
                  to fit the data field.

        Returns:
            Complete frame bytes (header + data + CRC).
        """
        # Pad or truncate data to fit
        if len(data) < self.data_length:
            payload = data + bytes(self.data_length - len(data))
        else:
            payload = data[:self.data_length]

        # Build header
        # Byte 0-1: Version(2) | SCID(10) | VCID(3) | OCF_flag(1)
        word0 = (0b00 << 14) | (self.spacecraft_id << 4) | (self.vcid << 1) | 0
        header = struct.pack('>H', word0)

        # Byte 2-3: Frame counter (16-bit)
        header += struct.pack('>H', self.frame_counter & 0xFFFF)

        # Byte 4-5: Frame length - 1
        header += struct.pack('>H', (self.frame_length - 1) & 0xFFFF)

        # Assemble frame (without CRC)
        frame = header + payload

        # CRC-16
        crc = ccsds_crc16(frame)
        frame += struct.pack('>H', crc)

        self.frame_counter = (self.frame_counter + 1) & 0xFFFF
        return frame

    def make_frame_with_asm(self, data: bytes) -> bytes:
        """Create frame with prepended ASM.

        Returns:
            ASM + frame bytes.
        """
        return ASM + self.make_frame(data)
