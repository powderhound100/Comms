# RF Safety Notes

## CRITICAL: Loopback Test Safety

1. **ALWAYS connect 30 dB attenuator** between PlutoSDR TX and RTL-SDR RX
2. **NEVER connect PlutoSDR TX directly to SAWbird+ LNA** — it will damage the LNA
3. **Keep bias-T OFF on RTL-SDR** during loopback testing
4. **PlutoSDR max output: 0 dBm (1 mW)** — with 30 dB attenuation, RX sees -30 dBm

## Test Bench Checklist

- [ ] Attenuator verified (30 dB)
- [ ] RTL-SDR bias-T confirmed OFF
- [ ] SMA connections hand-tight (do not over-torque)
- [ ] PlutoSDR TX power set to minimum initially
- [ ] No antennas connected during loopback (use cables only)
