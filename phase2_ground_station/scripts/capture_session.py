#!/usr/bin/env python3
"""Automated reception session orchestration.

Coordinates a complete reception session:
1. Fetches latest TLE from CelesTrak
2. Runs Phase 1 link budget to predict C/N₀
3. Starts IQ capture (placeholder — requires RTL-SDR hardware)
4. After capture, measures SNR
5. Logs predicted vs. measured to session_log.csv
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'phase1_link_budget'))

import csv
import math
from datetime import datetime, timezone
from pathlib import Path
import click

from src.link_budget import LinkBudget
from src.orbital import look_angles, slant_range


SESSION_LOG = Path(__file__).parent.parent / 'data' / 'session_log.csv'

LOG_HEADER = [
    'session_id', 'datetime_utc', 'satellite', 'freq_mhz',
    'duration_sec', 'elevation_deg', 'predicted_cn0_dbhz',
    'measured_cn0_dbhz', 'delta_db', 'decoded_ok', 'notes'
]


def predict_cn0_goes18(gs_lat: float = 47.6, gs_lon: float = -122.3) -> dict:
    """Run link budget prediction for GOES-18 LRIT."""
    az, el = look_angles(-137.2, gs_lat, gs_lon)
    dist = slant_range(35786, el)

    config = {
        'eirp_dbw': 42.0,
        'freq_hz': 1694.1e6,
        'distance_km': dist,
        'rx_antenna_gain_dbi': 12.5,
        'system_noise_temp_k': 105,
        'modulation': 'bpsk',
        'code_rate': 0.5,
        'symbol_rate_sps': 293000,
        'implementation_loss_db': 2.0,
        'rain_margin_db': 0,
        'pointing_loss_db': 1.0,
        'atmospheric_loss_db': 'auto',
        'elevation_deg': el,
    }

    lb = LinkBudget(config)
    result = lb.compute()
    return {
        'azimuth_deg': round(az, 1),
        'elevation_deg': round(el, 1),
        'distance_km': round(dist, 0),
        'predicted_cn0_dbhz': result.cn0_dbhz,
    }


def log_session(session_id: str, satellite: str, freq_mhz: float,
                duration_sec: int, elevation_deg: float,
                predicted_cn0: float, measured_cn0: float = None,
                decoded_ok: bool = None, notes: str = ''):
    """Append a session record to the log file."""
    SESSION_LOG.parent.mkdir(parents=True, exist_ok=True)
    file_exists = SESSION_LOG.exists()

    delta = round(predicted_cn0 - measured_cn0, 1) if measured_cn0 else ''

    with open(SESSION_LOG, 'a', newline='') as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow(LOG_HEADER)
        writer.writerow([
            session_id,
            datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S'),
            satellite,
            freq_mhz,
            duration_sec,
            elevation_deg,
            predicted_cn0,
            measured_cn0 or '',
            delta,
            decoded_ok if decoded_ok is not None else '',
            notes,
        ])


@click.command()
@click.option('--satellite', default='GOES-18', help='Target satellite')
@click.option('--duration', type=int, default=120, help='Capture duration (seconds)')
@click.option('--lat', type=float, default=47.6, help='Ground station latitude')
@click.option('--lon', type=float, default=-122.3, help='Ground station longitude')
def main(satellite, duration, lat, lon):
    """Run a capture session."""
    click.echo(f"GROUNDLINK Capture Session — {satellite}")
    click.echo("=" * 50)

    # Predict C/N₀
    pred = predict_cn0_goes18(lat, lon)
    click.echo(f"Azimuth:       {pred['azimuth_deg']}°")
    click.echo(f"Elevation:     {pred['elevation_deg']}°")
    click.echo(f"Slant Range:   {pred['distance_km']:.0f} km")
    click.echo(f"Predicted C/N₀: {pred['predicted_cn0_dbhz']:.1f} dB-Hz")
    click.echo()

    # IQ capture placeholder
    click.echo(f"[PLACEHOLDER] Would capture {duration}s of IQ data from RTL-SDR")
    click.echo("[PLACEHOLDER] Hardware not connected — skipping capture")
    click.echo()

    # Log prediction-only session
    session_id = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    log_session(
        session_id=session_id,
        satellite=satellite,
        freq_mhz=1694.1,
        duration_sec=duration,
        elevation_deg=pred['elevation_deg'],
        predicted_cn0=pred['predicted_cn0_dbhz'],
        notes='prediction_only_no_hardware'
    )
    click.echo(f"Session {session_id} logged to {SESSION_LOG}")


if __name__ == '__main__':
    main()
