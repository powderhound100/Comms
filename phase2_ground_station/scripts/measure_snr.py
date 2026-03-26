#!/usr/bin/env python3
"""Measure C/N₀ from IQ recordings using PSD estimation.

Method:
1. Compute PSD using Welch's method (4096-point FFT, Hann window)
2. Measure signal power in occupied bandwidth
3. Measure noise floor in adjacent clear spectrum
4. SNR = P_signal - P_noise (in dB, same bandwidth)
5. C/N₀ = SNR + 10*log₁₀(measurement_bandwidth)
"""

import math
import numpy as np
import click


def measure_cn0(iq_data: np.ndarray, sample_rate: float,
                center_freq: float, signal_bw: float) -> dict:
    """Measure C/N₀ from complex IQ data.

    Args:
        iq_data: Complex IQ samples (numpy array).
        sample_rate: Sample rate in Hz.
        center_freq: Center frequency in Hz (for reporting).
        signal_bw: Expected signal bandwidth in Hz.

    Returns:
        Dict with signal_power_dbm, noise_floor_dbm, snr_db, cn0_dbhz.
    """
    from scipy.signal import welch

    # Compute PSD using Welch's method
    nfft = 4096
    freqs, psd = welch(iq_data, fs=sample_rate, nperseg=nfft,
                       window='hann', return_onesided=False)

    # Shift to center
    freqs = np.fft.fftshift(freqs)
    psd = np.fft.fftshift(psd)

    # Signal band: center ± signal_bw/2
    signal_mask = np.abs(freqs) <= signal_bw / 2
    # Noise band: outside signal band but within 80% of Nyquist
    noise_mask = (np.abs(freqs) > signal_bw * 0.75) & (np.abs(freqs) < sample_rate * 0.4)

    if not np.any(signal_mask) or not np.any(noise_mask):
        raise ValueError("Could not identify signal and noise bands")

    # Average power spectral density (W/Hz)
    signal_psd_mean = np.mean(psd[signal_mask])
    noise_psd_mean = np.mean(psd[noise_mask])

    # Signal power in the signal bandwidth
    signal_power = signal_psd_mean * signal_bw
    noise_power = noise_psd_mean * signal_bw

    signal_power_dbw = 10 * math.log10(signal_power) if signal_power > 0 else -999
    noise_power_dbw = 10 * math.log10(noise_power) if noise_power > 0 else -999

    snr_db = signal_power_dbw - noise_power_dbw

    # C/N₀ = SNR + 10*log₁₀(BW)
    cn0_dbhz = snr_db + 10 * math.log10(signal_bw)

    return {
        'signal_power_dbw': round(signal_power_dbw, 2),
        'noise_power_dbw': round(noise_power_dbw, 2),
        'snr_db': round(snr_db, 2),
        'cn0_dbhz': round(cn0_dbhz, 2),
        'signal_bw_hz': signal_bw,
        'sample_rate_hz': sample_rate,
    }


def load_iq_file(filepath: str, sample_rate: float, dtype: str = 'cf32') -> np.ndarray:
    """Load IQ data from a raw binary file.

    Args:
        filepath: Path to IQ file.
        sample_rate: Sample rate (for info only).
        dtype: Data format - 'cf32' (complex float32) or 'cs16' (complex int16).

    Returns:
        Complex numpy array.
    """
    if dtype == 'cf32':
        raw = np.fromfile(filepath, dtype=np.float32)
        return raw[0::2] + 1j * raw[1::2]
    elif dtype == 'cs16':
        raw = np.fromfile(filepath, dtype=np.int16)
        return (raw[0::2] + 1j * raw[1::2]).astype(np.complex64) / 32768.0
    else:
        raise ValueError(f"Unknown dtype: {dtype}")


@click.command()
@click.option('--iq-file', required=True, type=click.Path(exists=True), help='IQ recording file')
@click.option('--sample-rate', type=float, required=True, help='Sample rate (Hz)')
@click.option('--center-freq', type=float, required=True, help='Center frequency (Hz)')
@click.option('--signal-bw', type=float, required=True, help='Signal bandwidth (Hz)')
@click.option('--dtype', type=click.Choice(['cf32', 'cs16']), default='cf32')
def main(iq_file, sample_rate, center_freq, signal_bw, dtype):
    """Measure C/N₀ from an IQ recording."""
    iq_data = load_iq_file(iq_file, sample_rate, dtype)
    click.echo(f"Loaded {len(iq_data)} samples ({len(iq_data)/sample_rate:.1f}s)")

    result = measure_cn0(iq_data, sample_rate, center_freq, signal_bw)
    click.echo(f"Signal Power: {result['signal_power_dbw']:.1f} dBW")
    click.echo(f"Noise Floor:  {result['noise_power_dbw']:.1f} dBW")
    click.echo(f"SNR:          {result['snr_db']:.1f} dB")
    click.echo(f"C/N₀:         {result['cn0_dbhz']:.1f} dB-Hz")


if __name__ == '__main__':
    main()
