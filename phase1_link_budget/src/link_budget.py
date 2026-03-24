"""Top-level link budget engine tying all Phase 1 modules together."""

import math
from dataclasses import dataclass, asdict
import numpy as np
import pandas as pd

from .constants import C, K_DB
from .orbital import slant_range
from .atmosphere import atmospheric_loss as calc_atm_loss
from .antenna import g_over_t
from .modulation import required_ebn0


@dataclass
class LinkBudgetResult:
    """Complete link budget breakdown."""
    eirp_dbw: float
    fspl_db: float
    atmospheric_loss_db: float
    pointing_loss_db: float
    rx_gain_dbi: float
    system_noise_temp_k: float
    g_over_t_dbk: float
    cn0_dbhz: float
    ebn0_available_db: float
    ebn0_required_db: float
    implementation_loss_db: float
    rain_margin_db: float
    link_margin_db: float


def free_space_path_loss(freq_hz: float, distance_km: float) -> float:
    """Compute Free Space Path Loss.

    FSPL = 20*log₁₀(4*π*d/λ) = 20*log₁₀(d) + 20*log₁₀(f) + 20*log₁₀(4π/c)

    Args:
        freq_hz: Frequency in Hz.
        distance_km: Distance in km.

    Returns:
        FSPL in dB (positive value).
    """
    distance_m = distance_km * 1000
    wavelength = C / freq_hz
    fspl = (4 * math.pi * distance_m / wavelength) ** 2
    return 10 * math.log10(fspl)


class LinkBudget:
    """Link budget calculator for space-to-ground communications."""

    def __init__(self, config: dict):
        """Initialize with link parameters.

        Config keys:
            tx_power_dbw: Transmit power (dBW)
            tx_antenna_gain_dbi: TX antenna gain (dBi)
            tx_loss_db: TX losses (dB, positive value)
            freq_hz: Carrier frequency (Hz)
            distance_km: Slant range (km)
            rx_antenna_gain_dbi: RX antenna gain (dBi)
            system_noise_temp_k: System noise temperature (K)
            modulation: 'bpsk', 'qpsk', or '8psk'
            code_rate: FEC code rate (e.g. 0.5)
            symbol_rate_sps: Symbol rate (symbols/sec)
            implementation_loss_db: Implementation loss (dB, positive)
            rain_margin_db: Rain fade margin (dB, positive)
            pointing_loss_db: Pointing loss (dB, positive)
            atmospheric_loss_db: Atmospheric loss (dB, positive) or 'auto'
        """
        self.config = config

    def compute(self) -> LinkBudgetResult:
        """Compute full link budget and return result."""
        c = self.config

        # EIRP
        tx_power = c.get('tx_power_dbw', 0)
        tx_gain = c.get('tx_antenna_gain_dbi', 0)
        tx_loss = c.get('tx_loss_db', 0)
        eirp_dbw = tx_power + tx_gain - tx_loss

        # If EIRP is specified directly, use it
        if 'eirp_dbw' in c:
            eirp_dbw = c['eirp_dbw']

        # Free space path loss
        freq_hz = c['freq_hz']
        distance_km = c['distance_km']
        fspl_db = free_space_path_loss(freq_hz, distance_km)

        # Atmospheric loss
        atm_loss = c.get('atmospheric_loss_db', 0)
        if atm_loss == 'auto':
            freq_ghz = freq_hz / 1e9
            el_deg = c.get('elevation_deg', 30)
            atm_loss = calc_atm_loss(freq_ghz, el_deg)

        pointing_loss = c.get('pointing_loss_db', 0)
        rain_margin = c.get('rain_margin_db', 0)
        impl_loss = c.get('implementation_loss_db', 0)

        # Receiver
        rx_gain = c['rx_antenna_gain_dbi']
        t_sys = c['system_noise_temp_k']
        got = g_over_t(rx_gain, t_sys)

        # C/N₀ = EIRP - FSPL - L_atm - L_pointing + G/T - k_dB
        cn0 = eirp_dbw - fspl_db - atm_loss - pointing_loss + got - K_DB

        # Eb/N₀
        modulation = c.get('modulation', 'bpsk')
        code_rate = c.get('code_rate', 0.5)
        symbol_rate = c.get('symbol_rate_sps', 256000)

        # Bit rate depends on modulation
        bits_per_symbol = {'bpsk': 1, 'qpsk': 2, '8psk': 3}.get(modulation, 1)
        bit_rate = symbol_rate * bits_per_symbol * code_rate
        ebn0_available = cn0 - 10 * math.log10(bit_rate)

        # Required Eb/N₀
        target_ber = c.get('target_ber', 1e-5)
        coded = code_rate < 1.0
        ebn0_required = required_ebn0(target_ber, modulation, coded, code_rate)

        # Link margin
        link_margin = ebn0_available - ebn0_required - impl_loss - rain_margin

        return LinkBudgetResult(
            eirp_dbw=round(eirp_dbw, 2),
            fspl_db=round(fspl_db, 2),
            atmospheric_loss_db=round(atm_loss, 2),
            pointing_loss_db=round(pointing_loss, 2),
            rx_gain_dbi=round(rx_gain, 2),
            system_noise_temp_k=round(t_sys, 2),
            g_over_t_dbk=round(got, 2),
            cn0_dbhz=round(cn0, 2),
            ebn0_available_db=round(ebn0_available, 2),
            ebn0_required_db=round(ebn0_required, 2),
            implementation_loss_db=round(impl_loss, 2),
            rain_margin_db=round(rain_margin, 2),
            link_margin_db=round(link_margin, 2),
        )

    def sweep_elevation(self, el_min: float, el_max: float,
                        el_step: float, altitude_km: float) -> pd.DataFrame:
        """Sweep elevation angle, recomputing slant range and atm loss.

        Args:
            el_min: Minimum elevation (degrees).
            el_max: Maximum elevation (degrees).
            el_step: Elevation step (degrees).
            altitude_km: Spacecraft altitude (km).

        Returns:
            DataFrame with columns for each link budget parameter.
        """
        results = []
        for el in np.arange(el_min, el_max + el_step / 2, el_step):
            config = dict(self.config)
            config['distance_km'] = slant_range(altitude_km, el)
            config['elevation_deg'] = el
            if config.get('atmospheric_loss_db') == 'auto':
                pass  # compute() handles it
            else:
                config['atmospheric_loss_db'] = calc_atm_loss(
                    config['freq_hz'] / 1e9, el)

            lb = LinkBudget(config)
            result = lb.compute()
            row = asdict(result)
            row['elevation_deg'] = el
            row['distance_km'] = config['distance_km']
            results.append(row)

        return pd.DataFrame(results)

    def sweep_frequency(self, f_min: float, f_max: float,
                        f_step: float) -> pd.DataFrame:
        """Sweep frequency to show FSPL and gain variation.

        Args:
            f_min: Minimum frequency (Hz).
            f_max: Maximum frequency (Hz).
            f_step: Frequency step (Hz).

        Returns:
            DataFrame with columns for each link budget parameter.
        """
        results = []
        for freq in np.arange(f_min, f_max + f_step / 2, f_step):
            config = dict(self.config)
            config['freq_hz'] = freq
            lb = LinkBudget(config)
            result = lb.compute()
            row = asdict(result)
            row['freq_hz'] = freq
            results.append(row)

        return pd.DataFrame(results)

    def to_table(self) -> str:
        """Pretty-print link budget as formatted table."""
        result = self.compute()
        lines = [
            "=" * 55,
            "  GROUNDLINK Link Budget Analysis",
            "=" * 55,
            f"  EIRP                    {result.eirp_dbw:>+10.2f} dBW",
            f"  Free Space Path Loss    {-result.fspl_db:>+10.2f} dB",
            f"  Atmospheric Loss        {-result.atmospheric_loss_db:>+10.2f} dB",
            f"  Pointing Loss           {-result.pointing_loss_db:>+10.2f} dB",
            "-" * 55,
            f"  RX Antenna Gain         {result.rx_gain_dbi:>+10.2f} dBi",
            f"  System Noise Temp       {result.system_noise_temp_k:>10.1f} K",
            f"  G/T                     {result.g_over_t_dbk:>+10.2f} dB/K",
            "-" * 55,
            f"  C/N₀                    {result.cn0_dbhz:>+10.2f} dB-Hz",
            f"  Eb/N₀ (available)       {result.ebn0_available_db:>+10.2f} dB",
            f"  Eb/N₀ (required)        {result.ebn0_required_db:>+10.2f} dB",
            f"  Implementation Loss     {-result.implementation_loss_db:>+10.2f} dB",
            f"  Rain Fade Margin        {-result.rain_margin_db:>+10.2f} dB",
            "=" * 55,
            f"  LINK MARGIN             {result.link_margin_db:>+10.2f} dB",
            "=" * 55,
        ]
        return "\n".join(lines)

    def to_dict(self) -> dict:
        """Export as dict for JSON serialization (dashboard API)."""
        result = self.compute()
        d = asdict(result)
        d['config'] = dict(self.config)
        return d
