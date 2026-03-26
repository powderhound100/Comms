"""Theoretical BER performance and required Eb/N₀ for digital modulations."""

import math
import numpy as np
from scipy.special import erfc


def ber_bpsk(ebn0_db: float) -> float:
    """Compute BER for uncoded BPSK.

    BER = Q(√(2*Eb/N₀)) = 0.5 * erfc(√(Eb/N₀))

    Args:
        ebn0_db: Eb/N₀ in dB.

    Returns:
        Bit Error Rate.
    """
    ebn0_linear = 10 ** (ebn0_db / 10)
    return 0.5 * erfc(math.sqrt(ebn0_linear))


def ber_qpsk(ebn0_db: float) -> float:
    """Compute BER for uncoded QPSK.

    Same as BPSK for the same Eb/N₀ (QPSK has double bandwidth efficiency
    but same energy per bit performance).

    Args:
        ebn0_db: Eb/N₀ in dB.

    Returns:
        Bit Error Rate.
    """
    return ber_bpsk(ebn0_db)


def ber_coded_bpsk(ebn0_db: float, code_rate: float = 0.5,
                   coding_gain_db: float = 5.0) -> float:
    """Approximate BER for coded BPSK.

    Approximates coded performance by shifting the uncoded curve by
    the coding gain.

    Args:
        ebn0_db: Eb/N₀ in dB (before coding rate adjustment).
        code_rate: Code rate (e.g., 0.5 for rate-1/2).
        coding_gain_db: Approximate coding gain in dB.

    Returns:
        Bit Error Rate.
    """
    effective_ebn0_db = ebn0_db + coding_gain_db
    return ber_bpsk(effective_ebn0_db)


def required_ebn0(target_ber: float, modulation: str = 'bpsk',
                  coded: bool = True, code_rate: float = 0.5) -> float:
    """Find required Eb/N₀ for a target BER.

    Uses binary search to invert the BER function.

    Args:
        target_ber: Target bit error rate.
        modulation: 'bpsk' or 'qpsk'.
        coded: Whether to use coded BER curve.
        code_rate: Code rate (if coded).

    Returns:
        Required Eb/N₀ in dB.
    """
    lo, hi = -5.0, 30.0

    for _ in range(100):
        mid = (lo + hi) / 2
        if coded:
            ber = ber_coded_bpsk(mid, code_rate)
        elif modulation == 'qpsk':
            ber = ber_qpsk(mid)
        else:
            ber = ber_bpsk(mid)

        if ber > target_ber:
            lo = mid
        else:
            hi = mid

    return (lo + hi) / 2


def plot_ber_curves(ebn0_range_db=None, modulations=None, coded=None):
    """Generate BER vs Eb/N₀ plot.

    Args:
        ebn0_range_db: Array of Eb/N₀ values in dB. Defaults to 0-14 dB.
        modulations: List of modulation types. Defaults to ['bpsk', 'qpsk'].
        coded: List of booleans. Defaults to [True, False].

    Returns:
        matplotlib Figure.
    """
    import matplotlib.pyplot as plt

    if ebn0_range_db is None:
        ebn0_range_db = np.arange(0, 14.1, 0.1)
    if modulations is None:
        modulations = ['bpsk', 'qpsk']
    if coded is None:
        coded = [True, False]

    fig, ax = plt.subplots(figsize=(10, 7))

    for mod in modulations:
        for is_coded in coded:
            ber_values = []
            for ebn0 in ebn0_range_db:
                if is_coded:
                    ber_values.append(ber_coded_bpsk(ebn0))
                elif mod == 'qpsk':
                    ber_values.append(ber_qpsk(ebn0))
                else:
                    ber_values.append(ber_bpsk(ebn0))

            label = f"{mod.upper()} {'coded (r=1/2)' if is_coded else 'uncoded'}"
            ax.semilogy(ebn0_range_db, ber_values, label=label)

    ax.set_xlabel('Eb/N₀ (dB)')
    ax.set_ylabel('Bit Error Rate')
    ax.set_title('BER vs Eb/N₀')
    ax.set_ylim(1e-7, 1)
    ax.grid(True, which='both', alpha=0.3)
    ax.legend()

    return fig
