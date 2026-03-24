#!/usr/bin/env python3
"""Plot BER curves from simulation results with theoretical overlays."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'phase1_link_budget'))

import csv
import math
import numpy as np
import matplotlib.pyplot as plt
from scipy.special import erfc
import click

from src.modulation import ber_bpsk, ber_coded_bpsk


def load_ber_csv(filepath: str) -> dict:
    """Load BER results from CSV."""
    ebn0 = []
    ber = []
    with open(filepath, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            ebn0.append(float(row['ebn0_db']))
            ber_val = float(row['ber'])
            if ber_val > 0:
                ber.append(ber_val)
                ebn0_clean = ebn0[-1]
            else:
                # Can't plot zero on log scale
                ebn0.pop()
    return {'ebn0_db': ebn0[:len(ber)], 'ber': ber}


@click.command()
@click.option('--measured', multiple=True, type=click.Path(exists=True),
              help='Measured BER CSV file(s)')
@click.option('--theoretical', multiple=True,
              help='Theoretical curves: bpsk_uncoded, bpsk_coded_r12')
@click.option('--output', type=click.Path(), default='ber_curves.png')
def main(measured, theoretical, output):
    """Plot BER curves from simulation and theory."""
    fig, ax = plt.subplots(figsize=(10, 7))

    # Plot theoretical curves
    ebn0_range = np.arange(0, 14.1, 0.1)
    for curve in theoretical:
        if curve == 'bpsk_uncoded':
            ber_vals = [ber_bpsk(e) for e in ebn0_range]
            ax.semilogy(ebn0_range, ber_vals, 'k-', linewidth=1.5,
                       label='BPSK uncoded (theory)')
        elif curve == 'bpsk_coded_r12':
            ber_vals = [ber_coded_bpsk(e) for e in ebn0_range]
            ax.semilogy(ebn0_range, ber_vals, 'b--', linewidth=1.5,
                       label='BPSK coded r=1/2 (theory)')

    # Plot measured results
    markers = ['o', 's', '^', 'D', 'v']
    colors = ['red', 'green', 'orange', 'purple', 'cyan']
    for i, filepath in enumerate(measured):
        data = load_ber_csv(filepath)
        label = os.path.splitext(os.path.basename(filepath))[0]
        ax.semilogy(data['ebn0_db'], data['ber'],
                   f'{markers[i % len(markers)]}-',
                   color=colors[i % len(colors)],
                   markersize=6, label=f'{label} (measured)')

    ax.set_xlabel('Eb/N₀ (dB)', fontsize=12)
    ax.set_ylabel('Bit Error Rate', fontsize=12)
    ax.set_title('GROUNDLINK BER vs Eb/N₀', fontsize=14)
    ax.set_ylim(1e-6, 1)
    ax.set_xlim(0, 14)
    ax.grid(True, which='both', alpha=0.3)
    ax.legend(fontsize=10)

    plt.tight_layout()
    plt.savefig(output, dpi=150)
    click.echo(f"Plot saved to {output}")


if __name__ == '__main__':
    main()
