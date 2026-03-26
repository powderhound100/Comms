"""Bit Error Rate counter for modem performance measurement.

Compares received bit stream against known transmitted pattern.
Uses cross-correlation for automatic bit alignment.
"""

import numpy as np


class BERCounter:
    """Count bit errors between transmitted and received bit streams."""

    def __init__(self):
        self.total_bits = 0
        self.error_bits = 0

    def reset(self):
        """Reset counters."""
        self.total_bits = 0
        self.error_bits = 0

    def count(self, tx_bits: np.ndarray, rx_bits: np.ndarray,
              auto_align: bool = True) -> dict:
        """Count bit errors between TX and RX bit streams.

        Args:
            tx_bits: Transmitted bit array.
            rx_bits: Received bit array.
            auto_align: If True, use cross-correlation to find best alignment.

        Returns:
            Dict with total_bits, error_bits, ber.
        """
        if auto_align:
            offset = self._find_alignment(tx_bits, rx_bits)
            if offset >= 0:
                rx_aligned = rx_bits[offset:]
            else:
                rx_aligned = rx_bits
        else:
            rx_aligned = rx_bits
            offset = 0

        # Compare equal-length portions
        compare_len = min(len(tx_bits), len(rx_aligned))
        if compare_len == 0:
            return {'total_bits': 0, 'error_bits': 0, 'ber': 0.0, 'offset': offset}

        tx_portion = tx_bits[:compare_len]
        rx_portion = rx_aligned[:compare_len]

        errors = int(np.sum(tx_portion != rx_portion))
        self.total_bits += compare_len
        self.error_bits += errors

        ber = errors / compare_len if compare_len > 0 else 0.0

        return {
            'total_bits': compare_len,
            'error_bits': errors,
            'ber': ber,
            'offset': offset,
            'cumulative_bits': self.total_bits,
            'cumulative_errors': self.error_bits,
            'cumulative_ber': self.error_bits / self.total_bits if self.total_bits > 0 else 0.0,
        }

    def _find_alignment(self, tx_bits: np.ndarray, rx_bits: np.ndarray,
                        search_range: int = 100) -> int:
        """Find best bit alignment using cross-correlation.

        Args:
            tx_bits: Reference bit pattern.
            rx_bits: Received bits to align.
            search_range: Maximum offset to search.

        Returns:
            Best alignment offset (bits).
        """
        # Use a portion of TX bits as correlation template
        template_len = min(64, len(tx_bits))
        template = 2 * tx_bits[:template_len].astype(np.float32) - 1

        search_len = min(search_range + template_len, len(rx_bits))
        search_signal = 2 * rx_bits[:search_len].astype(np.float32) - 1

        corr = np.correlate(search_signal, template, mode='valid')
        return int(np.argmax(corr))
