"""Orbital geometry computations for ground-station-to-spacecraft links."""

import math
import numpy as np
from .constants import C, R_EARTH_KM


def slant_range(altitude_km: float, elevation_deg: float,
                earth_radius_km: float = R_EARTH_KM) -> float:
    """Compute slant range from ground station to spacecraft.

    Uses law of cosines:
        d = -R*sin(θ) + sqrt((R*sin(θ))² + 2*R*h + h²)

    Args:
        altitude_km: Spacecraft altitude above Earth surface (km).
        elevation_deg: Elevation angle from ground station (degrees).
        earth_radius_km: Earth radius (km).

    Returns:
        Slant range in km.
    """
    R = earth_radius_km
    h = altitude_km
    theta = math.radians(elevation_deg)
    d = -R * math.sin(theta) + math.sqrt(
        (R * math.sin(theta)) ** 2 + 2 * R * h + h ** 2
    )
    return d


def max_doppler_shift(freq_hz: float, velocity_mps: float,
                      elevation_deg: float = 0.0) -> float:
    """Compute maximum Doppler shift for a satellite pass.

    Δf = f₀ * (v * cos(θ)) / c

    Args:
        freq_hz: Carrier frequency (Hz).
        velocity_mps: Satellite orbital velocity (m/s).
        elevation_deg: Elevation angle (degrees). 0° gives maximum Doppler.

    Returns:
        Doppler shift in Hz.
    """
    theta = math.radians(elevation_deg)
    return freq_hz * (velocity_mps * math.cos(theta)) / C


def doppler_curve(freq_hz: float, tle_line1: str, tle_line2: str,
                  ground_lat: float, ground_lon: float,
                  time_start, time_end, dt_sec: float = 1.0):
    """Compute Doppler shift over a satellite pass using SGP4 propagation.

    Args:
        freq_hz: Carrier frequency (Hz).
        tle_line1: TLE line 1.
        tle_line2: TLE line 2.
        ground_lat: Ground station latitude (degrees).
        ground_lon: Ground station longitude (degrees).
        time_start: Start datetime (UTC).
        time_end: End datetime (UTC).
        dt_sec: Time step (seconds).

    Returns:
        Tuple of (times, doppler_hz) arrays.
    """
    from sgp4.api import Satrec, WGS72
    from datetime import timedelta

    sat = Satrec.twoline2rv(tle_line1, tle_line2, WGS72)

    gs_lat_rad = math.radians(ground_lat)
    gs_lon_rad = math.radians(ground_lon)
    gs_ecef = _lla_to_ecef(gs_lat_rad, gs_lon_rad, 0.0)

    times = []
    doppler_hz = []
    t = time_start
    prev_range_km = None

    while t <= time_end:
        jd, fr = _datetime_to_jd(t)
        e, r, v = sat.sgp4(jd, fr)
        if e != 0:
            t += timedelta(seconds=dt_sec)
            continue

        # SGP4 returns TEME coordinates in km
        sat_ecef = _teme_to_ecef_approx(r, t)
        range_km = math.sqrt(sum((a - b) ** 2 for a, b in zip(sat_ecef, gs_ecef)))

        if prev_range_km is not None:
            range_rate_kmps = (range_km - prev_range_km) / dt_sec
            doppler = -freq_hz * (range_rate_kmps * 1000.0) / C
            doppler_hz.append(doppler)
            times.append(t)

        prev_range_km = range_km
        t += timedelta(seconds=dt_sec)

    return times, doppler_hz


def elevation_curve(tle_line1: str, tle_line2: str,
                    ground_lat: float, ground_lon: float,
                    time_start, time_end, dt_sec: float = 1.0):
    """Compute elevation angle over a satellite pass.

    Args:
        tle_line1: TLE line 1.
        tle_line2: TLE line 2.
        ground_lat: Ground station latitude (degrees).
        ground_lon: Ground station longitude (degrees).
        time_start: Start datetime (UTC).
        time_end: End datetime (UTC).
        dt_sec: Time step (seconds).

    Returns:
        Tuple of (times, elevation_deg) arrays.
    """
    from sgp4.api import Satrec, WGS72
    from datetime import timedelta

    sat = Satrec.twoline2rv(tle_line1, tle_line2, WGS72)

    gs_lat_rad = math.radians(ground_lat)
    gs_lon_rad = math.radians(ground_lon)
    gs_ecef = _lla_to_ecef(gs_lat_rad, gs_lon_rad, 0.0)

    times = []
    elevations = []
    t = time_start

    while t <= time_end:
        jd, fr = _datetime_to_jd(t)
        e, r, v = sat.sgp4(jd, fr)
        if e != 0:
            t += timedelta(seconds=dt_sec)
            continue

        sat_ecef = _teme_to_ecef_approx(r, t)
        el = _elevation_from_ecef(gs_ecef, sat_ecef, gs_lat_rad, gs_lon_rad)
        times.append(t)
        elevations.append(math.degrees(el))
        t += timedelta(seconds=dt_sec)

    return times, elevations


def look_angles(sat_lon_deg: float, ground_lat_deg: float,
                ground_lon_deg: float) -> tuple:
    """Compute azimuth and elevation for a GEO satellite.

    Args:
        sat_lon_deg: Satellite longitude (degrees East).
        ground_lat_deg: Ground station latitude (degrees).
        ground_lon_deg: Ground station longitude (degrees).

    Returns:
        Tuple of (azimuth_deg, elevation_deg).
    """
    lat = math.radians(ground_lat_deg)
    dlon = math.radians(sat_lon_deg - ground_lon_deg)

    # Relative position angle
    cos_rel = math.cos(lat) * math.cos(dlon)

    # Elevation
    R = R_EARTH_KM
    r_geo = 42164.0  # GEO orbital radius in km
    el = math.atan2(
        cos_rel - R / r_geo,
        math.sqrt(1 - cos_rel ** 2)
    )

    # Azimuth — ITU method for GEO satellites
    # In Northern Hemisphere: satellite west → az > 180°, east → az < 180°
    dlon_deg = sat_lon_deg - ground_lon_deg
    if ground_lat_deg >= 0:
        # Northern hemisphere
        if dlon_deg < 0:
            az_deg = 180.0 + math.degrees(
                math.atan(math.tan(math.radians(-dlon_deg)) / math.sin(lat)))
        else:
            az_deg = 180.0 - math.degrees(
                math.atan(math.tan(math.radians(dlon_deg)) / math.sin(lat)))
    else:
        # Southern hemisphere
        if dlon_deg < 0:
            az_deg = 360.0 - math.degrees(
                math.atan(math.tan(math.radians(-dlon_deg)) / math.sin(-lat)))
        else:
            az_deg = math.degrees(
                math.atan(math.tan(math.radians(dlon_deg)) / math.sin(-lat)))

    return az_deg % 360, math.degrees(el)


# --- Helper functions ---

def _lla_to_ecef(lat_rad: float, lon_rad: float, alt_km: float):
    """Convert LLA to ECEF coordinates (km)."""
    R = R_EARTH_KM + alt_km
    x = R * math.cos(lat_rad) * math.cos(lon_rad)
    y = R * math.cos(lat_rad) * math.sin(lon_rad)
    z = R * math.sin(lat_rad)
    return (x, y, z)


def _datetime_to_jd(dt):
    """Convert datetime to Julian Date (jd, fr) pair for SGP4."""
    from sgp4.api import jday
    jd, fr = jday(dt.year, dt.month, dt.day,
                  dt.hour, dt.minute, dt.second + dt.microsecond / 1e6)
    return jd, fr


def _teme_to_ecef_approx(r_teme, dt):
    """Approximate TEME to ECEF conversion using GMST rotation."""
    from sgp4.api import jday
    jd, fr = _datetime_to_jd(dt)
    # Greenwich Mean Sidereal Time (approximate)
    T = (jd + fr - 2451545.0) / 36525.0
    gmst = (280.46061837 + 360.98564736629 * (jd + fr - 2451545.0) +
            0.000387933 * T ** 2) % 360.0
    gmst_rad = math.radians(gmst)

    x = r_teme[0] * math.cos(gmst_rad) + r_teme[1] * math.sin(gmst_rad)
    y = -r_teme[0] * math.sin(gmst_rad) + r_teme[1] * math.cos(gmst_rad)
    z = r_teme[2]
    return (x, y, z)


def _elevation_from_ecef(gs_ecef, sat_ecef, gs_lat_rad, gs_lon_rad):
    """Compute elevation angle from ECEF positions."""
    dx = sat_ecef[0] - gs_ecef[0]
    dy = sat_ecef[1] - gs_ecef[1]
    dz = sat_ecef[2] - gs_ecef[2]

    # ENU transform
    sin_lat = math.sin(gs_lat_rad)
    cos_lat = math.cos(gs_lat_rad)
    sin_lon = math.sin(gs_lon_rad)
    cos_lon = math.cos(gs_lon_rad)

    e = -sin_lon * dx + cos_lon * dy
    n = -sin_lat * cos_lon * dx - sin_lat * sin_lon * dy + cos_lat * dz
    u = cos_lat * cos_lon * dx + cos_lat * sin_lon * dy + sin_lat * dz

    horiz = math.sqrt(e ** 2 + n ** 2)
    return math.atan2(u, horiz)
