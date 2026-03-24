#!/usr/bin/env python3
"""Satellite pass prediction using SGP4 TLE propagation.

Predicts satellite passes above a minimum elevation angle for a ground station.
Supports both GEO (always-visible) and LEO satellites.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'phase1_link_budget'))

import math
from datetime import datetime, timedelta, timezone
import click

from src.orbital import look_angles, elevation_curve


# Sample TLE data for common satellites
SAMPLE_TLES = {
    'GOES-18': (
        '1 51850U 22021A   26080.50000000  .00000000  00000-0  00000-0 0  9999',
        '2 51850   0.0352 270.4710 0000872 133.6640 226.3850  1.00272119 14870'
    ),
    'NOAA-19': (
        '1 33591U 09005A   26080.50000000  .00000067  00000-0  59000-4 0  9999',
        '2 33591  99.1918 100.0000 0014100  50.0000 310.2000 14.12400000890000'
    ),
    'METEOR-M2-3': (
        '1 57166U 23091A   26080.50000000  .00000042  00000-0  31500-4 0  9999',
        '2 57166  98.7700 150.0000 0005000  80.0000 280.2000 14.23600000140000'
    ),
}


def predict_geo_visibility(sat_name: str, sat_lon: float,
                           gs_lat: float, gs_lon: float):
    """Check GEO satellite visibility (always visible if elevation > 0)."""
    az, el = look_angles(sat_lon, gs_lat, gs_lon)
    return {
        'satellite': sat_name,
        'type': 'GEO',
        'azimuth_deg': round(az, 1),
        'elevation_deg': round(el, 1),
        'always_visible': el > 0,
    }


def predict_leo_passes(tle_line1: str, tle_line2: str,
                       gs_lat: float, gs_lon: float,
                       min_elevation: float = 10.0,
                       hours: float = 24.0,
                       start_time: datetime = None):
    """Predict LEO satellite passes above minimum elevation.

    Args:
        tle_line1: TLE line 1.
        tle_line2: TLE line 2.
        gs_lat: Ground station latitude (degrees).
        gs_lon: Ground station longitude (degrees).
        min_elevation: Minimum elevation for a valid pass (degrees).
        hours: Look-ahead window (hours).
        start_time: Start of prediction window (UTC).

    Returns:
        List of pass dicts with AOS, LOS, max elevation, duration.
    """
    if start_time is None:
        start_time = datetime.now(timezone.utc)

    end_time = start_time + timedelta(hours=hours)

    # Compute elevation curve at 10-second resolution
    times, elevations = elevation_curve(
        tle_line1, tle_line2, gs_lat, gs_lon,
        start_time, end_time, dt_sec=10.0
    )

    # Find passes (contiguous periods above min_elevation)
    passes = []
    in_pass = False
    pass_start = None
    max_el = 0

    for t, el in zip(times, elevations):
        if el >= min_elevation and not in_pass:
            in_pass = True
            pass_start = t
            max_el = el
        elif el >= min_elevation and in_pass:
            max_el = max(max_el, el)
        elif el < min_elevation and in_pass:
            in_pass = False
            duration_sec = (t - pass_start).total_seconds()
            if duration_sec > 30:  # filter very short passes
                passes.append({
                    'aos': pass_start.isoformat(),
                    'los': t.isoformat(),
                    'max_elevation_deg': round(max_el, 1),
                    'duration_sec': round(duration_sec),
                })

    return passes


@click.command()
@click.option('--satellite', required=True, help='Satellite name')
@click.option('--lat', type=float, default=47.6, help='Ground station latitude')
@click.option('--lon', type=float, default=-122.3, help='Ground station longitude')
@click.option('--min-elevation', type=float, default=10.0, help='Minimum elevation (deg)')
@click.option('--hours', type=float, default=24.0, help='Look-ahead hours')
def main(satellite, lat, lon, min_elevation, hours):
    """Predict satellite passes for a ground station."""
    sat_upper = satellite.upper()

    # Check for GEO satellites
    if 'GOES' in sat_upper:
        sat_lon = -137.2 if '18' in sat_upper or 'WEST' in sat_upper else -75.2
        result = predict_geo_visibility(satellite, sat_lon, lat, lon)
        click.echo(f"Satellite: {result['satellite']} ({result['type']})")
        click.echo(f"Azimuth:   {result['azimuth_deg']}°")
        click.echo(f"Elevation: {result['elevation_deg']}°")
        click.echo(f"Visible:   {'Yes (always)' if result['always_visible'] else 'No'}")
        return

    # LEO satellite pass prediction
    if sat_upper in SAMPLE_TLES:
        tle1, tle2 = SAMPLE_TLES[sat_upper]
    else:
        click.echo(f"Unknown satellite: {satellite}")
        click.echo(f"Available: {', '.join(SAMPLE_TLES.keys())}")
        return

    click.echo(f"Predicting passes for {satellite} (next {hours}h, min el={min_elevation}°)")
    click.echo(f"Ground Station: {lat}°N, {lon}°E")
    click.echo("-" * 60)

    passes = predict_leo_passes(tle1, tle2, lat, lon, min_elevation, hours)

    if not passes:
        click.echo("No passes found in the specified window.")
        return

    for i, p in enumerate(passes, 1):
        click.echo(f"Pass {i}:")
        click.echo(f"  AOS:      {p['aos']}")
        click.echo(f"  LOS:      {p['los']}")
        click.echo(f"  Max El:   {p['max_elevation_deg']}°")
        click.echo(f"  Duration: {p['duration_sec']}s")


if __name__ == '__main__':
    main()
