"""Tests for modulation and BER calculations."""

import math
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.modulation import ber_bpsk, ber_qpsk, ber_coded_bpsk, required_ebn0


class TestBERBPSK:
    def test_ber_at_0db(self):
        """BER at 0 dB Eb/N₀ should be ~0.079."""
        ber = ber_bpsk(0.0)
        assert 0.05 < ber < 0.12

    def test_ber_at_9_6db(self):
        """BER at 9.6 dB → ~10⁻⁵."""
        ber = ber_bpsk(9.6)
        assert 1e-6 < ber < 1e-4

    def test_ber_at_high_snr(self):
        """BER at 14 dB should be very low."""
        ber = ber_bpsk(14.0)
        assert ber < 1e-7

    def test_ber_monotonically_decreasing(self):
        ber_low = ber_bpsk(5.0)
        ber_high = ber_bpsk(10.0)
        assert ber_high < ber_low


class TestBERQPSK:
    def test_qpsk_same_as_bpsk(self):
        """QPSK BER should equal BPSK BER at same Eb/N₀."""
        for ebn0 in [0, 3, 6, 9, 12]:
            assert abs(ber_qpsk(ebn0) - ber_bpsk(ebn0)) < 1e-15


class TestBERCoded:
    def test_coding_gain(self):
        """Coded BPSK should have lower BER than uncoded at same Eb/N₀."""
        ebn0 = 5.0
        assert ber_coded_bpsk(ebn0) < ber_bpsk(ebn0)


class TestRequiredEbN0:
    def test_uncoded_bpsk_1e5(self):
        """Required Eb/N₀ for BER=10⁻⁵ uncoded BPSK → ~9.6 dB."""
        req = required_ebn0(1e-5, 'bpsk', coded=False)
        assert 9.0 < req < 10.5

    def test_coded_bpsk_1e5(self):
        """Required Eb/N₀ for coded BPSK should be lower."""
        req_uncoded = required_ebn0(1e-5, 'bpsk', coded=False)
        req_coded = required_ebn0(1e-5, 'bpsk', coded=True)
        assert req_coded < req_uncoded
