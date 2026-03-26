#!/usr/bin/env python3
"""Cantenna feed dimension calculator for L-band satellite reception.

Computes dimensions for a cylindrical waveguide (cantenna) feed
suitable for parabolic dish illumination at L-band frequencies.
"""

import math

# Speed of light (m/s)
C = 299_792_458


def compute_feed_dimensions(freq_hz: float, can_inner_dia_mm: float = 130.0):
    """Compute cantenna feed dimensions for a given frequency.

    The cantenna operates in TE11 mode. The cutoff frequency for TE11 in a
    circular waveguide is: f_c = 1.8412 * c / (pi * D)

    Args:
        freq_hz: Target center frequency (Hz).
        can_inner_dia_mm: Inner diameter of the can (mm).

    Returns:
        Dict with all feed dimensions.
    """
    freq_mhz = freq_hz / 1e6
    wavelength_mm = (C / freq_hz) * 1000

    # TE11 cutoff frequency for this can diameter
    can_dia_m = can_inner_dia_mm / 1000
    te11_cutoff_hz = 1.8412 * C / (math.pi * can_dia_m)
    te11_cutoff_mhz = te11_cutoff_hz / 1e6

    # Verify the can supports propagation at the target frequency
    if freq_hz < te11_cutoff_hz:
        raise ValueError(
            f"Can diameter {can_inner_dia_mm} mm is too small for {freq_mhz} MHz. "
            f"TE11 cutoff = {te11_cutoff_mhz:.0f} MHz. Need larger can."
        )

    # Probe length = λ/4
    probe_length_mm = wavelength_mm / 4

    # Probe position from closed end = λ/4
    probe_position_mm = wavelength_mm / 4

    # Can length ≈ λ (0.75λ to 1.0λ typical)
    can_length_mm = wavelength_mm

    return {
        'frequency_mhz': freq_mhz,
        'wavelength_mm': round(wavelength_mm, 1),
        'can_inner_dia_mm': can_inner_dia_mm,
        'te11_cutoff_mhz': round(te11_cutoff_mhz, 0),
        'can_length_mm': round(can_length_mm, 0),
        'probe_length_mm': round(probe_length_mm, 1),
        'probe_position_mm': round(probe_length_mm, 1),
        'connector_type': 'SMA panel-mount female',
    }


def print_feed_design(dims: dict):
    """Pretty-print the feed design."""
    print(f"{'='*50}")
    print(f"  GROUNDLINK Cantenna Feed Design")
    print(f"{'='*50}")
    print(f"  Frequency:        {dims['frequency_mhz']:.1f} MHz")
    print(f"  Wavelength:       {dims['wavelength_mm']:.1f} mm")
    print(f"  Can inner dia:    {dims['can_inner_dia_mm']:.0f} mm "
          f"(TE11 cutoff ~{dims['te11_cutoff_mhz']:.0f} MHz)")
    print(f"  Can length:       {dims['can_length_mm']:.0f} mm (≈ λ)")
    print(f"  Probe length:     {dims['probe_length_mm']:.1f} mm (λ/4)")
    print(f"  Probe position:   {dims['probe_position_mm']:.1f} mm from closed end (λ/4)")
    print(f"  Connector:        {dims['connector_type']}")
    print(f"{'='*50}")


if __name__ == '__main__':
    # GOES LRIT frequency
    dims = compute_feed_dimensions(1694.1e6, can_inner_dia_mm=130)
    print_feed_design(dims)
