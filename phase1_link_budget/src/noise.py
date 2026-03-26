"""Cascaded noise temperature computation using Friis formula."""

import math
from .constants import T0


def noise_temp_from_nf(noise_figure_db: float) -> float:
    """Convert noise figure to equivalent noise temperature.

    T = T₀ * (10^(NF/10) - 1)

    Args:
        noise_figure_db: Noise figure in dB.

    Returns:
        Equivalent noise temperature in Kelvin.
    """
    return T0 * (10 ** (noise_figure_db / 10) - 1)


def cascaded_noise_temp(stages: list) -> float:
    """Compute cascaded noise temperature using Friis formula.

    T_sys = T₁ + T₂/G₁ + T₃/(G₁*G₂) + ...

    Args:
        stages: List of dicts with 'gain_db' and 'noise_figure_db' keys.
                Each dict represents a stage in the receiver chain.

    Returns:
        Total cascaded noise temperature in Kelvin.
    """
    if not stages:
        return 0.0

    total_temp = noise_temp_from_nf(stages[0]['noise_figure_db'])
    cumulative_gain = 10 ** (stages[0]['gain_db'] / 10)

    for stage in stages[1:]:
        stage_temp = noise_temp_from_nf(stage['noise_figure_db'])
        total_temp += stage_temp / cumulative_gain
        cumulative_gain *= 10 ** (stage['gain_db'] / 10)

    return total_temp


def system_noise_temp(antenna_temp_k: float, stages: list) -> float:
    """Compute total system noise temperature.

    T_sys = T_ant + T_receiver (cascaded)

    Args:
        antenna_temp_k: Antenna noise temperature in Kelvin.
        stages: List of receiver chain stages (see cascaded_noise_temp).

    Returns:
        Total system noise temperature in Kelvin.
    """
    return antenna_temp_k + cascaded_noise_temp(stages)
