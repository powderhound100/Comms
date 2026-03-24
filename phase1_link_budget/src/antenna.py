"""Antenna gain and pattern calculations."""

import math
from .constants import C


def parabolic_gain(diameter_m: float, freq_hz: float,
                   efficiency: float = 0.55) -> float:
    """Compute gain of a circular parabolic antenna.

    G = η * (π*D/λ)²

    Args:
        diameter_m: Dish diameter in meters.
        freq_hz: Operating frequency in Hz.
        efficiency: Aperture efficiency (0 to 1, typical 0.55).

    Returns:
        Gain in dBi.
    """
    wavelength = C / freq_hz
    gain_linear = efficiency * (math.pi * diameter_m / wavelength) ** 2
    return 10 * math.log10(gain_linear)


def parabolic_beamwidth(diameter_m: float, freq_hz: float) -> float:
    """Compute 3 dB beamwidth of a parabolic antenna.

    θ_3dB ≈ 70 * λ / D

    Args:
        diameter_m: Dish diameter in meters.
        freq_hz: Operating frequency in Hz.

    Returns:
        3 dB beamwidth in degrees.
    """
    wavelength = C / freq_hz
    return 70 * wavelength / diameter_m


def offset_parabolic_gain(width_m: float, height_m: float, freq_hz: float,
                          efficiency: float = 0.55) -> float:
    """Compute gain of an offset (oval) parabolic antenna.

    Uses effective aperture area = π/4 * width * height for an oval.

    Args:
        width_m: Aperture width in meters.
        height_m: Aperture height in meters.
        freq_hz: Operating frequency in Hz.
        efficiency: Aperture efficiency (0 to 1).

    Returns:
        Gain in dBi.
    """
    wavelength = C / freq_hz
    area = math.pi / 4 * width_m * height_m
    gain_linear = efficiency * 4 * math.pi * area / wavelength ** 2
    return 10 * math.log10(gain_linear)


def g_over_t(gain_dbi: float, system_noise_temp_k: float) -> float:
    """Compute antenna G/T (figure of merit).

    G/T = G_dBi - 10*log₁₀(T_sys)

    Args:
        gain_dbi: Antenna gain in dBi.
        system_noise_temp_k: System noise temperature in Kelvin.

    Returns:
        G/T in dB/K.
    """
    return gain_dbi - 10 * math.log10(system_noise_temp_k)
