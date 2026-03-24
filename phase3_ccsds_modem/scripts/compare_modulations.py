#!/usr/bin/env python3
"""Compare BER performance across modulation schemes."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'phase1_link_budget'))

import numpy as np
import matplotlib.pyplot as plt
import click

from src.modulation import ber_bpsk, ber_qpsk, ber_coded_bpsk


@click.command()
@click.option('--output', type=click.Path(), default='modulation_comparison.png')
def main(output):
    """Generate modulation comparison plot."""
    ebn0 = np.arange(0, 14.1, 0.1)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))

    # BER comparison
    ax1.semilogy(ebn0, [ber_bpsk(e) for e in ebn0], 'b-', label='BPSK uncoded')
    ax1.semilogy(ebn0, [ber_qpsk(e) for e in ebn0], 'r--', label='QPSK uncoded')
    ax1.semilogy(ebn0, [ber_coded_bpsk(e, 0.5, 5.0) for e in ebn0],
                'g-', label='BPSK coded r=1/2 (5 dB gain)')
    ax1.semilogy(ebn0, [ber_coded_bpsk(e, 0.75, 3.5) for e in ebn0],
                'm--', label='BPSK coded r=3/4 (3.5 dB gain)')

    ax1.set_xlabel('Eb/N₀ (dB)')
    ax1.set_ylabel('BER')
    ax1.set_title('BER vs Eb/N₀ — Modulation Comparison')
    ax1.set_ylim(1e-7, 1)
    ax1.grid(True, which='both', alpha=0.3)
    ax1.legend()

    # Spectral efficiency comparison
    schemes = ['BPSK\nr=1/2', 'BPSK\nuncoded', 'QPSK\nr=1/2', 'QPSK\nuncoded']
    efficiencies = [0.5, 1.0, 1.0, 2.0]
    colors = ['#2196F3', '#4CAF50', '#FF9800', '#F44336']
    ax2.bar(schemes, efficiencies, color=colors)
    ax2.set_ylabel('Spectral Efficiency (bits/s/Hz)')
    ax2.set_title('Spectral Efficiency Comparison')
    ax2.grid(True, axis='y', alpha=0.3)

    plt.tight_layout()
    plt.savefig(output, dpi=150)
    click.echo(f"Comparison plot saved to {output}")


if __name__ == '__main__':
    main()
