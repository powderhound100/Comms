"""CCSDS pseudo-random sequence generator for frame randomization.

LFSR polynomial: x⁸ + x⁷ + x⁵ + x³ + 1
Initial state: 0xFF
Resets at each frame boundary (ASM not randomized).
"""

import numpy as np


class CCSDSRandomizer:
    """CCSDS randomizer/derandomizer using LFSR sequence."""

    POLYNOMIAL_TAPS = [7, 5, 3]  # x^8 + x^7 + x^5 + x^3 + 1
    INITIAL_STATE = 0xFF

    def __init__(self):
        self._sequence_cache = None
        self._cache_length = 0

    def _generate_sequence(self, length_bytes: int) -> bytes:
        """Generate CCSDS pseudo-random sequence.

        Args:
            length_bytes: Number of bytes to generate.

        Returns:
            Pseudo-random byte sequence.
        """
        if self._sequence_cache is not None and self._cache_length >= length_bytes:
            return self._sequence_cache[:length_bytes]

        state = self.INITIAL_STATE
        sequence = bytearray(length_bytes)

        for i in range(length_bytes):
            output_byte = 0
            for bit in range(8):
                # Output is MSB of register
                output_bit = (state >> 7) & 1
                output_byte = (output_byte << 1) | output_bit

                # Feedback: XOR of tapped bits
                feedback = 0
                for tap in self.POLYNOMIAL_TAPS:
                    feedback ^= (state >> tap) & 1
                feedback ^= (state >> 7) & 1  # x^8 term

                # Shift register
                state = ((state << 1) | feedback) & 0xFF

            sequence[i] = output_byte

        self._sequence_cache = bytes(sequence)
        self._cache_length = length_bytes
        return self._sequence_cache

    def randomize(self, data: bytes) -> bytes:
        """Randomize data by XORing with CCSDS PN sequence.

        Args:
            data: Input data bytes.

        Returns:
            Randomized data bytes.
        """
        seq = self._generate_sequence(len(data))
        return bytes(a ^ b for a, b in zip(data, seq))

    def derandomize(self, data: bytes) -> bytes:
        """Derandomize data. Same operation as randomize (XOR is self-inverse)."""
        return self.randomize(data)
