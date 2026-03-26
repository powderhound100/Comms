"""Command-line interface for GROUNDLINK link budget calculations."""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import click
from src.link_budget import LinkBudget, free_space_path_loss
from src.orbital import slant_range, look_angles, max_doppler_shift


@click.group()
def cli():
    """GROUNDLINK Link Budget Calculator."""
    pass


@cli.command()
@click.option('--sat-lon', type=float, required=True, help='Satellite longitude (deg East)')
@click.option('--freq', type=float, required=True, help='Frequency (Hz)')
@click.option('--eirp', type=float, required=True, help='Satellite EIRP (dBW)')
@click.option('--rx-gain', type=float, required=True, help='RX antenna gain (dBi)')
@click.option('--tsys', type=float, required=True, help='System noise temperature (K)')
@click.option('--symbol-rate', type=float, required=True, help='Symbol rate (sps)')
@click.option('--modulation', type=click.Choice(['bpsk', 'qpsk']), default='bpsk')
@click.option('--code-rate', type=float, default=0.5, help='FEC code rate')
@click.option('--impl-loss', type=float, default=2.0, help='Implementation loss (dB)')
@click.option('--rain-margin', type=float, default=3.0, help='Rain fade margin (dB)')
@click.option('--pointing-loss', type=float, default=1.0, help='Pointing loss (dB)')
@click.option('--ground-lat', type=float, default=47.6, help='Ground station latitude')
@click.option('--ground-lon', type=float, default=-122.3, help='Ground station longitude')
def geo(sat_lon, freq, eirp, rx_gain, tsys, symbol_rate, modulation,
        code_rate, impl_loss, rain_margin, pointing_loss, ground_lat, ground_lon):
    """GEO satellite link budget analysis."""
    az, el = look_angles(sat_lon, ground_lat, ground_lon)
    dist = slant_range(35786, el)

    click.echo(f"Look Angles: Az={az:.1f}°, El={el:.1f}°")
    click.echo(f"Slant Range: {dist:.0f} km")
    click.echo()

    config = {
        'eirp_dbw': eirp,
        'freq_hz': freq,
        'distance_km': dist,
        'rx_antenna_gain_dbi': rx_gain,
        'system_noise_temp_k': tsys,
        'modulation': modulation,
        'code_rate': code_rate,
        'symbol_rate_sps': symbol_rate,
        'implementation_loss_db': impl_loss,
        'rain_margin_db': rain_margin,
        'pointing_loss_db': pointing_loss,
        'atmospheric_loss_db': 'auto',
        'elevation_deg': el,
    }

    lb = LinkBudget(config)
    click.echo(lb.to_table())


@cli.command()
@click.option('--altitude', type=float, required=True, help='Orbital altitude (km)')
@click.option('--freq', type=float, required=True, help='Frequency (Hz)')
@click.option('--eirp', type=float, required=True, help='Satellite EIRP (dBW)')
@click.option('--rx-gain', type=float, required=True, help='RX antenna gain (dBi)')
@click.option('--tsys', type=float, required=True, help='System noise temperature (K)')
@click.option('--symbol-rate', type=float, default=256000, help='Symbol rate (sps)')
@click.option('--modulation', type=click.Choice(['bpsk', 'qpsk']), default='bpsk')
@click.option('--code-rate', type=float, default=0.5, help='FEC code rate')
@click.option('--el-min', type=float, default=10, help='Minimum elevation (deg)')
@click.option('--el-max', type=float, default=85, help='Maximum elevation (deg)')
@click.option('--el-step', type=float, default=5, help='Elevation step (deg)')
def leo(altitude, freq, eirp, rx_gain, tsys, symbol_rate, modulation,
        code_rate, el_min, el_max, el_step):
    """LEO satellite pass analysis — sweep elevation angle."""
    config = {
        'eirp_dbw': eirp,
        'freq_hz': freq,
        'distance_km': slant_range(altitude, el_min),
        'rx_antenna_gain_dbi': rx_gain,
        'system_noise_temp_k': tsys,
        'modulation': modulation,
        'code_rate': code_rate,
        'symbol_rate_sps': symbol_rate,
        'implementation_loss_db': 2.0,
        'rain_margin_db': 0,
        'pointing_loss_db': 1.0,
        'atmospheric_loss_db': 'auto',
        'elevation_deg': el_min,
    }

    lb = LinkBudget(config)
    df = lb.sweep_elevation(el_min, el_max, el_step, altitude)

    click.echo(f"LEO Pass Analysis — Altitude: {altitude} km, Freq: {freq/1e6:.1f} MHz")
    click.echo("=" * 75)
    click.echo(f"{'El(°)':>6} {'Range(km)':>10} {'FSPL(dB)':>10} {'C/N₀(dB-Hz)':>12} {'Margin(dB)':>11}")
    click.echo("-" * 75)
    for _, row in df.iterrows():
        click.echo(
            f"{row['elevation_deg']:>6.0f} {row['distance_km']:>10.0f} "
            f"{row['fspl_db']:>10.1f} {row['cn0_dbhz']:>12.1f} {row['link_margin_db']:>11.1f}"
        )


@cli.command()
@click.option('--freq', type=float, required=True, help='Frequency (Hz)')
@click.option('--altitude', type=float, default=830, help='Orbital altitude (km)')
@click.option('--velocity', type=float, default=7500, help='Orbital velocity (m/s)')
def doppler(freq, altitude, velocity):
    """Doppler shift prediction for LEO satellites."""
    click.echo(f"Doppler Analysis — Freq: {freq/1e6:.1f} MHz, Alt: {altitude} km")
    click.echo("=" * 55)

    for el in [0, 5, 10, 20, 30, 45, 60, 90]:
        d_shift = max_doppler_shift(freq, velocity, el)
        click.echo(f"  Elevation {el:>3}°: Doppler = ±{d_shift:>10.1f} Hz ({d_shift/1000:>6.2f} kHz)")


if __name__ == '__main__':
    cli()
