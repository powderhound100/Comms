"""Atmospheric and rain attenuation models per ITU-R recommendations."""

import math


def atmospheric_loss(freq_ghz: float, elevation_deg: float) -> float:
    """Compute atmospheric gaseous absorption loss.

    Simplified ITU-R P.676 model for gaseous absorption (oxygen + water vapor).
    Valid for frequencies below ~50 GHz and elevation > 5°.

    Args:
        freq_ghz: Frequency in GHz.
        elevation_deg: Elevation angle in degrees.

    Returns:
        Atmospheric loss in dB (positive value).
    """
    if elevation_deg < 1.0:
        elevation_deg = 1.0

    # Zenith attenuation (simplified model for clear air)
    # Oxygen absorption dominates below 10 GHz
    # Water vapor adds above ~10 GHz
    if freq_ghz < 1.0:
        zenith_db = 0.01 * freq_ghz
    elif freq_ghz < 10.0:
        zenith_db = 0.01 + 0.02 * (freq_ghz - 1.0)
    elif freq_ghz < 30.0:
        zenith_db = 0.19 + 0.015 * (freq_ghz - 10.0)
    else:
        zenith_db = 0.49 + 0.03 * (freq_ghz - 30.0)

    # Scale by elevation (cosecant law for slant path through atmosphere)
    return zenith_db / math.sin(math.radians(elevation_deg))


def rain_attenuation(freq_ghz: float, elevation_deg: float,
                     rain_rate_mmh: float = 10.0,
                     availability_pct: float = 99.5) -> float:
    """Compute rain attenuation using simplified ITU-R P.618 model.

    Simplified for Seattle climate zone (rain region K).

    Args:
        freq_ghz: Frequency in GHz.
        elevation_deg: Elevation angle in degrees.
        rain_rate_mmh: Rain rate exceeded for (100-availability)% of time (mm/hr).
        availability_pct: Link availability percentage.

    Returns:
        Rain attenuation in dB (positive value).
    """
    if elevation_deg < 1.0:
        elevation_deg = 1.0

    # ITU-R P.838 specific attenuation coefficients (simplified)
    # gamma_R = k * R^alpha (dB/km)
    if freq_ghz < 1.0:
        return 0.0  # Rain attenuation negligible below 1 GHz

    # Approximate k and alpha for horizontal polarization
    k = 0.0000998 * freq_ghz ** 1.67
    alpha = 1.0 + 0.006 * freq_ghz

    gamma_r = k * rain_rate_mmh ** alpha  # dB/km

    # Effective path length through rain (simplified)
    rain_height_km = 3.0  # Approximate for mid-latitudes
    if elevation_deg >= 10.0:
        path_km = rain_height_km / math.sin(math.radians(elevation_deg))
    else:
        path_km = 2 * rain_height_km / (
            math.sqrt(math.sin(math.radians(elevation_deg)) ** 2 + 2 * rain_height_km / 8500) +
            math.sin(math.radians(elevation_deg))
        )

    # Path reduction factor
    r = 1.0 / (1.0 + 0.045 * path_km)

    return gamma_r * path_km * r


def scintillation_loss(freq_ghz: float, elevation_deg: float) -> float:
    """Compute tropospheric scintillation loss.

    Low-elevation scintillation margin, typically < 0.5 dB above 10°.

    Args:
        freq_ghz: Frequency in GHz.
        elevation_deg: Elevation angle in degrees.

    Returns:
        Scintillation loss in dB (positive value).
    """
    if elevation_deg < 1.0:
        elevation_deg = 1.0

    # Simplified scintillation model
    # Scintillation increases with frequency and decreases with elevation
    sigma = 0.025 * freq_ghz ** 0.5 / (math.sin(math.radians(elevation_deg)) ** 1.2)

    # 99.5% fade margin (~2.6 sigma)
    return 2.6 * sigma
