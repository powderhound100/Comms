#!/usr/bin/env python3
"""Quantify implementation loss: horizontal dB shift between OTA and simulated BER curves."""

import csv
import math
import click
import numpy as np


def interpolate_ebn0_at_ber(ebn0_values, ber_values, target_ber):
    """Find Eb/N₀ at a target BER by linear interpolation in log domain."""
    log_ber = np.log10(np.array(ber_values))
    log_target = math.log10(target_ber)

    for i in range(len(log_ber) - 1):
        if log_ber[i] >= log_target >= log_ber[i + 1]:
            # Linear interpolation
            frac = (log_target - log_ber[i]) / (log_ber[i + 1] - log_ber[i])
            return ebn0_values[i] + frac * (ebn0_values[i + 1] - ebn0_values[i])
    return None


@click.command()
@click.option('--sim-csv', required=True, type=click.Path(exists=True), help='Simulation BER CSV')
@click.option('--ota-csv', required=True, type=click.Path(exists=True), help='OTA BER CSV')
@click.option('--target-ber', type=float, default=1e-5, help='Target BER for comparison')
def main(sim_csv, ota_csv, target_ber):
    """Compare simulated vs OTA BER to quantify implementation loss."""
    def load_csv(path):
        ebn0, ber = [], []
        with open(path) as f:
            for row in csv.DictReader(f):
                ebn0.append(float(row['ebn0_db']))
                ber.append(float(row['ber']))
        return ebn0, ber

    sim_ebn0, sim_ber = load_csv(sim_csv)
    ota_ebn0, ota_ber = load_csv(ota_csv)

    sim_at_target = interpolate_ebn0_at_ber(sim_ebn0, sim_ber, target_ber)
    ota_at_target = interpolate_ebn0_at_ber(ota_ebn0, ota_ber, target_ber)

    click.echo(f"Target BER: {target_ber:.0e}")
    if sim_at_target:
        click.echo(f"Simulation Eb/N₀ at target: {sim_at_target:.2f} dB")
    if ota_at_target:
        click.echo(f"OTA Eb/N₀ at target:        {ota_at_target:.2f} dB")
    if sim_at_target and ota_at_target:
        impl_loss = ota_at_target - sim_at_target
        click.echo(f"Implementation Loss:        {impl_loss:.2f} dB")
        if impl_loss < 2.0:
            click.echo("Status: PASS (< 2.0 dB)")
        else:
            click.echo("Status: INVESTIGATE (≥ 2.0 dB)")


if __name__ == '__main__':
    main()
