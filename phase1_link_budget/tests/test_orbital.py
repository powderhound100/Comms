"""Tests for orbital geometry calculations."""

import math
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.orbital import slant_range, max_doppler_shift, look_angles


class TestSlantRange:
    def test_geo_at_30_deg_elevation(self):
        """GEO slant range at 30° elevation → ~38,000-39,000 km."""
        d = slant_range(35786, 30)
        assert 37500 < d < 39500

    def test_geo_at_90_deg_elevation(self):
        """GEO at zenith should equal altitude."""
        d = slant_range(35786, 90)
        assert abs(d - 35786) < 1

    def test_leo_at_10_deg_elevation(self):
        """LEO 830 km at 10° should be ~2400 km."""
        d = slant_range(830, 10)
        assert 2000 < d < 3000

    def test_leo_at_90_deg(self):
        """LEO at zenith should equal altitude."""
        d = slant_range(830, 90)
        assert abs(d - 830) < 1

    def test_slant_range_increases_with_lower_elevation(self):
        d_high = slant_range(830, 60)
        d_low = slant_range(830, 10)
        assert d_low > d_high


class TestDoppler:
    def test_max_doppler_leo_1700mhz(self):
        """LEO Doppler at 1.7 GHz, 7.5 km/s, overhead → ~±42.5 kHz."""
        d = max_doppler_shift(1.7e9, 7500, 0)
        assert abs(d / 1000 - 42.5) < 5

    def test_doppler_zero_at_zenith(self):
        """Doppler should be zero at 90° elevation."""
        d = max_doppler_shift(1.7e9, 7500, 90)
        assert abs(d) < 1

    def test_doppler_proportional_to_frequency(self):
        d1 = max_doppler_shift(1e9, 7500, 0)
        d2 = max_doppler_shift(2e9, 7500, 0)
        assert abs(d2 / d1 - 2.0) < 0.01


class TestLookAngles:
    def test_goes18_from_seattle(self):
        """GOES-18 at -137.2° from Seattle (47.6°N, -122.3°W)."""
        az, el = look_angles(-137.2, 47.6, -122.3)
        # Elevation should be around 30°
        assert 20 < el < 40
        # Azimuth should be south-southwest (satellite is west of ground station)
        assert 190 < az < 230
