#!/usr/bin/env python3
"""Analyze IQ impairments from captured constellation data.

Measures:
- DC offset (mean I/Q)
- IQ amplitude imbalance
- IQ phase imbalance
- EVM (Error Vector Magnitude)
"""

import math
import numpy as np
import click


def analyze_impairments(iq_data: np.ndarray, constellation: str = 'bpsk') -> dict:
    """Analyze IQ impairments in received constellation.

    Args:
        iq_data: Complex IQ samples (after timing/carrier recovery).
        constellation: 'bpsk' or 'qpsk'.

    Returns:
        Dict with impairment measurements.
    """
    i_data = np.real(iq_data)
    q_data = np.imag(iq_data)

    # DC offset
    dc_i = np.mean(i_data)
    dc_q = np.mean(q_data)
    signal_rms = np.sqrt(np.mean(np.abs(iq_data) ** 2))
    dc_offset_pct = np.sqrt(dc_i ** 2 + dc_q ** 2) / signal_rms * 100

    # IQ imbalance
    i_power = np.mean(i_data ** 2)
    q_power = np.mean(q_data ** 2)
    amplitude_imbalance_db = 10 * math.log10(i_power / q_power) if q_power > 0 else 0

    # Phase imbalance (cross-correlation method)
    correlation = np.mean(i_data * q_data)
    phase_imbalance_deg = math.degrees(math.asin(
        2 * correlation / (np.sqrt(i_power) * np.sqrt(q_power))
    )) if i_power > 0 and q_power > 0 else 0

    # EVM
    if constellation == 'bpsk':
        ideal = np.sign(i_data) + 0j
    else:  # qpsk
        ideal = np.sign(i_data) + 1j * np.sign(q_data)
        ideal /= np.sqrt(2)

    error_vectors = iq_data - ideal
    evm_rms = np.sqrt(np.mean(np.abs(error_vectors) ** 2)) / signal_rms * 100

    return {
        'dc_offset_i': round(float(dc_i), 6),
        'dc_offset_q': round(float(dc_q), 6),
        'dc_offset_pct': round(float(dc_offset_pct), 2),
        'amplitude_imbalance_db': round(float(amplitude_imbalance_db), 3),
        'phase_imbalance_deg': round(float(phase_imbalance_deg), 2),
        'evm_pct': round(float(evm_rms), 2),
    }


@click.command()
@click.option('--iq-file', required=True, type=click.Path(exists=True))
@click.option('--constellation', type=click.Choice(['bpsk', 'qpsk']), default='bpsk')
def main(iq_file, constellation):
    """Analyze IQ impairments from captured data."""
    raw = np.fromfile(iq_file, dtype=np.float32)
    iq_data = raw[0::2] + 1j * raw[1::2]

    result = analyze_impairments(iq_data, constellation)
    click.echo(f"IQ Impairment Analysis ({constellation.upper()})")
    click.echo("=" * 45)
    click.echo(f"  DC Offset (I):         {result['dc_offset_i']:.6f}")
    click.echo(f"  DC Offset (Q):         {result['dc_offset_q']:.6f}")
    click.echo(f"  DC Offset (% signal):  {result['dc_offset_pct']:.2f}%")
    click.echo(f"  Amplitude Imbalance:   {result['amplitude_imbalance_db']:.3f} dB")
    click.echo(f"  Phase Imbalance:       {result['phase_imbalance_deg']:.2f}°")
    click.echo(f"  EVM (RMS):             {result['evm_pct']:.2f}%")


if __name__ == '__main__':
    main()
