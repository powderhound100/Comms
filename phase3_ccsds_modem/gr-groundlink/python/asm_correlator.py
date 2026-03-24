"""Attached Sync Marker (ASM) correlator for CCSDS frame synchronization.

Correlates incoming bit stream against the CCSDS ASM pattern 0x1ACFFC1D.
Detects frame boundaries when correlation exceeds threshold.
"""

import numpy as np

# CCSDS ASM: 0x1ACFFC1D = 0001 1010 1100 1111 1111 1100 0001 1101
ASM_PATTERN = 0x1ACFFC1D
ASM_BITS = 32


def _int_to_bits(value: int, num_bits: int) -> np.ndarray:
    """Convert integer to bit array (MSB first)."""
    return np.array([(value >> (num_bits - 1 - i)) & 1
                     for i in range(num_bits)], dtype=np.uint8)


ASM_BIT_ARRAY = _int_to_bits(ASM_PATTERN, ASM_BITS)


class ASMCorrelator:
    """Detect CCSDS Attached Sync Markers in a bit stream."""

    def __init__(self, threshold: int = 1):
        """Initialize correlator.

        Args:
            threshold: Maximum number of bit errors tolerated in ASM match.
                      Default 1 (31/32 bits must match).
        """
        self.threshold = threshold
        self.asm_bits = ASM_BIT_ARRAY

    def correlate(self, bit_stream: np.ndarray) -> list:
        """Find all ASM positions in a bit stream.

        Args:
            bit_stream: Array of bits (0s and 1s).

        Returns:
            List of bit positions where ASM was detected.
        """
        if len(bit_stream) < ASM_BITS:
            return []

        positions = []
        for i in range(len(bit_stream) - ASM_BITS + 1):
            window = bit_stream[i:i + ASM_BITS]
            errors = np.sum(window != self.asm_bits)
            if errors <= self.threshold:
                positions.append(i)

        return positions

    def correlate_fast(self, bit_stream: np.ndarray) -> list:
        """Fast ASM detection using numpy correlation.

        Converts to +1/-1 for correlation then checks threshold.

        Args:
            bit_stream: Array of bits (0s and 1s).

        Returns:
            List of bit positions where ASM was detected.
        """
        if len(bit_stream) < ASM_BITS:
            return []

        # Convert to +1/-1
        stream_bipolar = 2 * bit_stream.astype(np.float32) - 1
        asm_bipolar = 2 * self.asm_bits.astype(np.float32) - 1

        # Sliding correlation
        corr = np.correlate(stream_bipolar, asm_bipolar, mode='valid')

        # Threshold: ASM_BITS - 2*threshold (bipolar correlation)
        min_corr = ASM_BITS - 2 * self.threshold
        positions = np.where(corr >= min_corr)[0].tolist()

        return positions
