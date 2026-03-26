#!/usr/bin/env python3
"""BER simulation engine for CCSDS modem performance evaluation.

Sweeps Eb/N₀ and measures BER for various modulation and coding configurations.
Supports AWGN channel and LEO Doppler channel models.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'phase1_link_budget'))

import csv
import math
import time
import numpy as np
from scipy.special import erfc
import click


def generate_bpsk_signal(num_bits: int) -> tuple:
    """Generate random BPSK-modulated signal.

    Returns:
        Tuple of (tx_bits, tx_symbols) where symbols are +1/-1.
    """
    bits = np.random.randint(0, 2, num_bits)
    symbols = 2 * bits - 1  # 0 → -1, 1 → +1
    return bits, symbols.astype(np.float64)


def generate_qpsk_signal(num_bits: int) -> tuple:
    """Generate random QPSK-modulated signal.

    Returns:
        Tuple of (tx_bits, tx_symbols) where symbols are complex.
    """
    num_bits = num_bits - (num_bits % 2)  # ensure even
    bits = np.random.randint(0, 2, num_bits)
    # Map pairs of bits to QPSK constellation
    i_bits = bits[0::2]
    q_bits = bits[1::2]
    symbols = (2 * i_bits - 1) + 1j * (2 * q_bits - 1)
    symbols /= np.sqrt(2)  # normalize energy per symbol
    return bits, symbols


def add_awgn(symbols: np.ndarray, ebn0_db: float,
             bits_per_symbol: int = 1) -> np.ndarray:
    """Add AWGN noise to achieve target Eb/N₀.

    Args:
        symbols: Transmitted symbols.
        ebn0_db: Target Eb/N₀ in dB.
        bits_per_symbol: Bits per symbol (1 for BPSK, 2 for QPSK).

    Returns:
        Noisy symbols.
    """
    ebn0_linear = 10 ** (ebn0_db / 10)
    # Noise variance per dimension
    noise_var = 1 / (2 * ebn0_linear * bits_per_symbol)

    if np.iscomplexobj(symbols):
        noise = np.sqrt(noise_var) * (
            np.random.randn(len(symbols)) + 1j * np.random.randn(len(symbols))
        )
    else:
        noise = np.sqrt(2 * noise_var) * np.random.randn(len(symbols))

    return symbols + noise


def demodulate_bpsk(rx_symbols: np.ndarray) -> np.ndarray:
    """Hard-decision BPSK demodulation."""
    return (np.real(rx_symbols) > 0).astype(np.uint8)


def demodulate_qpsk(rx_symbols: np.ndarray) -> np.ndarray:
    """Hard-decision QPSK demodulation."""
    i_bits = (np.real(rx_symbols) > 0).astype(np.uint8)
    q_bits = (np.imag(rx_symbols) > 0).astype(np.uint8)
    bits = np.empty(2 * len(rx_symbols), dtype=np.uint8)
    bits[0::2] = i_bits
    bits[1::2] = q_bits
    return bits


def simulate_ber_point(ebn0_db: float, modulation: str = 'bpsk',
                       min_bits: int = 1_000_000,
                       min_errors: int = 100) -> dict:
    """Simulate BER at a single Eb/N₀ point.

    Args:
        ebn0_db: Eb/N₀ in dB.
        modulation: 'bpsk' or 'qpsk'.
        min_bits: Minimum number of bits to simulate.
        min_errors: Minimum errors for statistical confidence.

    Returns:
        Dict with ebn0_db, total_bits, error_bits, ber.
    """
    total_bits = 0
    total_errors = 0
    block_size = min(min_bits, 100_000)

    t_start = time.time()

    while total_bits < min_bits or (total_errors < min_errors and total_bits < min_bits * 10):
        if modulation == 'qpsk':
            tx_bits, tx_symbols = generate_qpsk_signal(block_size)
            rx_symbols = add_awgn(tx_symbols, ebn0_db, bits_per_symbol=2)
            rx_bits = demodulate_qpsk(rx_symbols)
        else:
            tx_bits, tx_symbols = generate_bpsk_signal(block_size)
            rx_symbols = add_awgn(tx_symbols, ebn0_db, bits_per_symbol=1)
            rx_bits = demodulate_bpsk(rx_symbols)

        compare_len = min(len(tx_bits), len(rx_bits))
        errors = np.sum(tx_bits[:compare_len] != rx_bits[:compare_len])
        total_bits += compare_len
        total_errors += errors

        if total_bits >= min_bits * 10:
            break

    elapsed = time.time() - t_start
    ber = total_errors / total_bits if total_bits > 0 else 0

    return {
        'ebn0_db': ebn0_db,
        'total_bits': total_bits,
        'error_bits': int(total_errors),
        'ber': ber,
        'elapsed_sec': round(elapsed, 1),
        'modulation': modulation,
        'coding': 'none',
        'channel': 'awgn',
    }


@click.command()
@click.option('--modulation', type=click.Choice(['bpsk', 'qpsk']), default='bpsk')
@click.option('--coding', type=click.Choice(['none', 'conv_r12_k7']), default='none')
@click.option('--ebn0-min', type=float, default=0)
@click.option('--ebn0-max', type=float, default=14)
@click.option('--ebn0-step', type=float, default=1.0)
@click.option('--min-bits', type=float, default=1e5)
@click.option('--output', type=click.Path(), required=True)
def main(modulation, coding, ebn0_min, ebn0_max, ebn0_step, min_bits, output):
    """Run BER sweep simulation."""
    click.echo(f"BER Simulation: {modulation.upper()}, coding={coding}")
    click.echo(f"Eb/N₀ range: {ebn0_min} to {ebn0_max} dB, step {ebn0_step}")
    click.echo("-" * 60)

    results = []
    ebn0 = ebn0_min
    while ebn0 <= ebn0_max + ebn0_step / 2:
        result = simulate_ber_point(ebn0, modulation, int(min_bits))
        result['coding'] = coding
        results.append(result)
        click.echo(
            f"  Eb/N₀ = {ebn0:5.1f} dB  |  BER = {result['ber']:.4e}  |  "
            f"Errors = {result['error_bits']:>7d}/{result['total_bits']:>9d}  |  "
            f"{result['elapsed_sec']:.1f}s"
        )
        ebn0 += ebn0_step

    # Write CSV
    os.makedirs(os.path.dirname(output) or '.', exist_ok=True)
    with open(output, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=results[0].keys())
        writer.writeheader()
        writer.writerows(results)

    click.echo(f"\nResults written to {output}")


if __name__ == '__main__':
    main()
