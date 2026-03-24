"""Tests for noise temperature calculations."""

import math
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.noise import noise_temp_from_nf, cascaded_noise_temp, system_noise_temp


class TestNoiseTemp:
    def test_0db_noise_figure(self):
        """0 dB NF should give 0 K noise temperature."""
        assert abs(noise_temp_from_nf(0.0)) < 0.01

    def test_3db_noise_figure(self):
        """3 dB NF should give 290 K."""
        t = noise_temp_from_nf(3.0)
        assert abs(t - 290) < 5

    def test_sawbird_nf(self):
        """SAWbird+ NF=0.5 dB → ~35.5 K."""
        t = noise_temp_from_nf(0.5)
        assert 30 < t < 40


class TestCascadedNoise:
    def test_sawbird_plus_rtlsdr(self):
        """SAWbird+ (NF=0.5, G=34) + RTL-SDR (NF=4.5): T_rx ≈ 35.5 K."""
        stages = [
            {'gain_db': 34, 'noise_figure_db': 0.5},
            {'gain_db': 42, 'noise_figure_db': 4.5},
        ]
        t = cascaded_noise_temp(stages)
        # SAWbird contributes ~35K, RTL-SDR contribution is ~528K / 2512 ≈ 0.2K
        assert 30 < t < 40

    def test_single_stage(self):
        stages = [{'gain_db': 20, 'noise_figure_db': 3.0}]
        t = cascaded_noise_temp(stages)
        assert abs(t - noise_temp_from_nf(3.0)) < 0.01


class TestSystemNoise:
    def test_full_system(self):
        """With T_ant=50K, SAWbird+RTL-SDR: T_sys ≈ 105 K."""
        stages = [
            {'gain_db': 34, 'noise_figure_db': 0.5},
            {'gain_db': 42, 'noise_figure_db': 4.5},
        ]
        t_sys = system_noise_temp(50, stages)
        # T_ant(50) + feed(~20) ... simplified: expect ~85-110 K
        assert 80 < t_sys < 120
