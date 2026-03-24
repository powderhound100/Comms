#!/usr/bin/env python3
"""Generate Doppler channel model for LEO satellite pass simulation.

Creates a time-varying frequency offset profile that mimics a LEO pass,
suitable for testing modem performance under Doppler conditions.
"""

import math
import csv
import numpy as np
import click


def generate_leo_doppler_profile(freq_hz: float, altitude_km: float = 830,
                                 duration_sec: float = 600,
                                 max_elevation_deg: float = 60,
                                 dt_sec: float = 0.1) -> tuple:
    """Generate a synthetic LEO Doppler profile.

    Models a satellite pass as a sinusoidal-like Doppler curve going
    from positive (approaching) through zero (overhead) to negative (receding).

    Args:
        freq_hz: Carrier frequency (Hz).
        altitude_km: Orbital altitude (km).
        duration_sec: Total pass duration (seconds).
        max_elevation_deg: Maximum elevation during pass (degrees).
        dt_sec: Time step (seconds).

    Returns:
        Tuple of (times_sec, doppler_hz).
    """
    # Orbital velocity at altitude
    R_earth = 6371  # km
    mu = 3.986e5  # km^3/s^2
    r = R_earth + altitude_km
    v_orbit = math.sqrt(mu / r) * 1000  # m/s

    # Maximum Doppler shift
    max_doppler = freq_hz * v_orbit / 299792458

    times = np.arange(0, duration_sec + dt_sec / 2, dt_sec)

    # Model pass as cosine: max positive at start, zero at midpoint, max negative at end
    # Scale by max elevation (higher pass = faster Doppler crossing)
    scale = math.cos(math.radians(90 - max_elevation_deg))
    doppler = max_doppler * scale * np.cos(math.pi * times / duration_sec)

    return times, doppler


@click.command()
@click.option('--freq', type=float, default=1694.1e6, help='Carrier frequency (Hz)')
@click.option('--altitude', type=float, default=830, help='Orbital altitude (km)')
@click.option('--duration', type=float, default=600, help='Pass duration (seconds)')
@click.option('--max-el', type=float, default=60, help='Max elevation (degrees)')
@click.option('--output', type=click.Path(), required=True, help='Output CSV')
def main(freq, altitude, duration, max_el, output):
    """Generate synthetic LEO Doppler channel profile."""
    times, doppler = generate_leo_doppler_profile(freq, altitude, duration, max_el)

    with open(output, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['time_sec', 'doppler_hz', 'doppler_khz'])
        for t, d in zip(times, doppler):
            writer.writerow([f'{t:.1f}', f'{d:.1f}', f'{d/1000:.3f}'])

    click.echo(f"Doppler profile: {len(times)} samples, "
               f"max shift ±{max(abs(doppler)):.0f} Hz")
    click.echo(f"Written to {output}")


if __name__ == '__main__':
    main()
