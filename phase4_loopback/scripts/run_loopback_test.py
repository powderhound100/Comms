#!/usr/bin/env python3
"""Over-the-air loopback BER test orchestration.

Coordinates the PlutoSDR TX → attenuator → RTL-SDR RX loopback test.
This is a framework script — actual hardware operation requires GNU Radio runtime.
"""

import click


@click.command()
@click.option('--freq', type=float, default=2200e6, help='Test frequency (Hz)')
@click.option('--symbol-rate', type=float, default=256000, help='Symbol rate (sps)')
@click.option('--attenuation', type=float, default=30, help='Attenuator value (dB)')
@click.option('--gain-min', type=float, default=0, help='Min RTL-SDR gain (dB)')
@click.option('--gain-max', type=float, default=49.6, help='Max RTL-SDR gain (dB)')
@click.option('--gain-step', type=float, default=2.0, help='Gain step (dB)')
@click.option('--bits-per-point', type=int, default=1000000, help='Bits per measurement')
def main(freq, symbol_rate, attenuation, gain_min, gain_max, gain_step, bits_per_point):
    """Run OTA loopback BER sweep.

    This script requires:
    - ADALM-Pluto SDR connected (TX)
    - RTL-SDR V4 connected (RX)
    - 30 dB attenuator between TX and RX
    - GNU Radio runtime installed
    """
    click.echo("GROUNDLINK Over-the-Air Loopback Test")
    click.echo("=" * 55)
    click.echo(f"  Frequency:    {freq/1e6:.1f} MHz")
    click.echo(f"  Symbol Rate:  {symbol_rate/1000:.0f} ksps")
    click.echo(f"  Attenuation:  {attenuation} dB")
    click.echo(f"  Gain Sweep:   {gain_min} to {gain_max} dB, step {gain_step}")
    click.echo(f"  Bits/point:   {bits_per_point:,}")
    click.echo()

    click.echo("RF SAFETY CHECK:")
    click.echo("  [!] Verify attenuator is connected between TX and RX")
    click.echo("  [!] Verify bias-T is OFF on RTL-SDR")
    click.echo("  [!] DO NOT connect PlutoSDR directly to SAWbird+ LNA")
    click.echo()

    click.echo("[PLACEHOLDER] Hardware loopback test requires GNU Radio runtime")
    click.echo("[PLACEHOLDER] Use gnuradio/loopback_full.grc for actual test execution")
    click.echo()
    click.echo("Expected output format:")
    click.echo(f"{'Gain(dB)':>10} {'Est Eb/N₀':>10} {'BER':>12} {'Errors':>10} {'Bits':>12}")
    click.echo("-" * 60)

    gain = gain_min
    while gain <= gain_max:
        click.echo(f"{gain:>10.1f} {'[needs HW]':>10} {'[needs HW]':>12} {'—':>10} {'—':>12}")
        gain += gain_step


if __name__ == '__main__':
    main()
