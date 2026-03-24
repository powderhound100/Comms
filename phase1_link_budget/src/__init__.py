"""GROUNDLINK Phase 1 — Link Budget Engine."""

from .constants import C, K, K_DB, R_EARTH_KM, H_ATM_KM
from .orbital import slant_range, max_doppler_shift, look_angles
from .atmosphere import atmospheric_loss, rain_attenuation, scintillation_loss
from .antenna import parabolic_gain, parabolic_beamwidth, offset_parabolic_gain, g_over_t
from .noise import noise_temp_from_nf, cascaded_noise_temp, system_noise_temp
from .modulation import ber_bpsk, ber_qpsk, ber_coded_bpsk, required_ebn0
from .link_budget import LinkBudget, LinkBudgetResult
