"""Tests for the top-level link budget engine."""

import math
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.link_budget import LinkBudget, LinkBudgetResult, free_space_path_loss
from src.antenna import parabolic_gain, offset_parabolic_gain


class TestFSPL:
    def test_goes_lrit_fspl(self):
        """FSPL at 1694 MHz, 38126 km → ~188.7 dB (FSPL formula: 32.45 + 20log(f_MHz) + 20log(d_km))."""
        fspl = free_space_path_loss(1694.1e6, 38126)
        assert abs(fspl - 188.65) < 0.2

    def test_fspl_doubles_with_double_distance(self):
        """Doubling distance adds ~6 dB."""
        fspl1 = free_space_path_loss(1e9, 1000)
        fspl2 = free_space_path_loss(1e9, 2000)
        assert abs((fspl2 - fspl1) - 6.02) < 0.1


class TestAntennaGain:
    def test_slimline5_at_1694mhz(self):
        """Slimline 5 (0.51x0.61m) at 1694 MHz with η=0.55."""
        gain = offset_parabolic_gain(0.51, 0.61, 1694.1e6, efficiency=0.55)
        assert 16.0 < gain < 18.5

    def test_slimline5_at_2200mhz(self):
        """Slimline 5 at 2200 MHz → higher gain than at 1694 MHz."""
        gain_low = offset_parabolic_gain(0.51, 0.61, 1694.1e6, efficiency=0.55)
        gain_high = offset_parabolic_gain(0.51, 0.61, 2200e6, efficiency=0.55)
        assert gain_high > gain_low

    def test_round_dish_0_5m(self):
        """0.5m round dish at 1.7 GHz with η=0.55."""
        gain = parabolic_gain(0.5, 1.7e9, efficiency=0.55)
        assert 15.0 < gain < 18.0

    def test_gain_increases_with_frequency(self):
        g1 = parabolic_gain(0.5, 1e9)
        g2 = parabolic_gain(0.5, 2e9)
        assert g2 > g1


class TestGOESLinkBudget:
    def setup_method(self):
        self.config = {
            'eirp_dbw': 42.0,
            'freq_hz': 1694.1e6,
            'distance_km': 38126,
            'rx_antenna_gain_dbi': 12.5,
            'system_noise_temp_k': 105,
            'modulation': 'bpsk',
            'code_rate': 0.5,
            'symbol_rate_sps': 293000,
            'implementation_loss_db': 2.0,
            'rain_margin_db': 3.0,
            'pointing_loss_db': 1.0,
            'atmospheric_loss_db': 0.5,
        }

    def test_cn0(self):
        """GOES-18 LRIT C/N₀ should be in reasonable range."""
        lb = LinkBudget(self.config)
        result = lb.compute()
        assert 70 < result.cn0_dbhz < 80

    def test_positive_margin(self):
        """GOES-18 LRIT should have positive link margin."""
        lb = LinkBudget(self.config)
        result = lb.compute()
        assert result.link_margin_db > 5.0

    def test_link_margin_approximately_11db(self):
        """GOES-18 LRIT link margin ≈ +11 dB."""
        lb = LinkBudget(self.config)
        result = lb.compute()
        assert abs(result.link_margin_db - 11.0) < 3.0

    def test_to_table(self):
        lb = LinkBudget(self.config)
        table = lb.to_table()
        assert 'LINK MARGIN' in table
        assert 'EIRP' in table

    def test_to_dict(self):
        lb = LinkBudget(self.config)
        d = lb.to_dict()
        assert 'cn0_dbhz' in d
        assert 'config' in d
        assert d['config']['freq_hz'] == 1694.1e6

    def test_sweep_elevation(self):
        lb = LinkBudget(self.config)
        df = lb.sweep_elevation(10, 60, 10, 35786)
        assert len(df) >= 5
        # Margin should increase with elevation
        assert df.iloc[-1]['link_margin_db'] > df.iloc[0]['link_margin_db']
