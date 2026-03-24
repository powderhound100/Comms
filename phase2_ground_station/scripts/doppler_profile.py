#!/usr/bin/env python3
"""Generate Doppler correction table for a satellite pass.

Outputs a CSV file with timestamp, elapsed time, Doppler shift, and
corrected frequency for each time step during a pass.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'phase1_link_budget'))

import csv
from datetime import datetime, timezone
import click

from src.orbital import doppler_curve


@click.command()
@click.option('--tle', required=True, type=click.Path(exists=True), help='TLE file path')
@click.option('--freq', type=float, required=True, help='Center frequency (Hz)')
@click.option('--lat', type=float, default=47.6, help='Ground station latitude')
@click.option('--lon', type=float, default=-122.3, help='Ground station longitude')
@click.option('--pass-time', required=True, help='Pass start time (ISO 8601 UTC)')
@click.option('--duration', type=float, default=600, help='Duration (seconds)')
@click.option('--dt', type=float, default=1.0, help='Time step (seconds)')
@click.option('--output', type=click.Path(), required=True, help='Output CSV path')
def main(tle, freq, lat, lon, pass_time, duration, dt, output):
    """Generate Doppler correction table for a satellite pass."""
    # Read TLE
    with open(tle, 'r') as f:
        lines = [l.strip() for l in f.readlines() if l.strip()]
    if len(lines) >= 3:
        tle_line1, tle_line2 = lines[1], lines[2]
    elif len(lines) >= 2:
        tle_line1, tle_line2 = lines[0], lines[1]
    else:
        click.echo("Error: TLE file must contain at least 2 lines")
        return

    # Parse start time
    from datetime import timedelta
    start = datetime.fromisoformat(pass_time.replace('Z', '+00:00'))
    end = start + timedelta(seconds=duration)

    # Compute Doppler curve
    times, doppler_hz = doppler_curve(freq, tle_line1, tle_line2, lat, lon, start, end, dt)

    # Write CSV
    with open(output, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['timestamp_utc', 'elapsed_sec', 'doppler_hz', 'corrected_freq_hz'])
        for t, d in zip(times, doppler_hz):
            elapsed = (t - start).total_seconds()
            writer.writerow([
                t.strftime('%Y-%m-%dT%H:%M:%S'),
                f'{elapsed:.1f}',
                f'{d:.1f}',
                f'{freq + d:.0f}'
            ])

    click.echo(f"Doppler profile written to {output} ({len(times)} samples)")


if __name__ == '__main__':
    main()
