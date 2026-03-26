#!/usr/bin/env python3
"""Compare predicted C/N₀ (from link budget) with measured C/N₀ (from IQ recording)."""

import click
from measure_snr import load_iq_file, measure_cn0


@click.command()
@click.option('--predicted-cn0', type=float, required=True, help='Predicted C/N₀ (dB-Hz)')
@click.option('--measured-iq', required=True, type=click.Path(exists=True), help='IQ file')
@click.option('--sample-rate', type=float, required=True, help='Sample rate (Hz)')
@click.option('--signal-bw', type=float, required=True, help='Signal bandwidth (Hz)')
@click.option('--dtype', type=click.Choice(['cf32', 'cs16']), default='cf32')
def main(predicted_cn0, measured_iq, sample_rate, signal_bw, dtype):
    """Compare predicted vs measured C/N₀."""
    iq_data = load_iq_file(measured_iq, sample_rate, dtype)
    result = measure_cn0(iq_data, sample_rate, 0, signal_bw)

    measured = result['cn0_dbhz']
    delta = predicted_cn0 - measured

    click.echo(f"Predicted C/N₀: {predicted_cn0:.1f} dB-Hz")
    click.echo(f"Measured C/N₀:  {measured:.1f} dB-Hz")
    click.echo(f"Delta:          {delta:+.1f} dB")

    if abs(delta) < 2.0:
        click.echo("Status: PASS (within 2 dB)")
    else:
        click.echo("Status: INVESTIGATE (delta > 2 dB)")


if __name__ == '__main__':
    main()
