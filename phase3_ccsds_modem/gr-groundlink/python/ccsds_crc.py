"""CCSDS CRC-16 implementation (CRC-16/CCITT)."""


def ccsds_crc16(data: bytes) -> int:
    """Compute CCSDS CRC-16-CCITT.

    Polynomial: x^16 + x^12 + x^5 + 1 (0x1021)
    Initial value: 0xFFFF

    Args:
        data: Input bytes.

    Returns:
        16-bit CRC value.
    """
    crc = 0xFFFF
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ 0x1021
            else:
                crc = crc << 1
            crc &= 0xFFFF
    return crc
