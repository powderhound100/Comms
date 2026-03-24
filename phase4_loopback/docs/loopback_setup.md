# Loopback Test Setup

## Hardware Configuration

```
PlutoSDR TX → SMA cable → 30 dB Attenuator → SMA cable → RTL-SDR RX
                                                          (bias-T OFF)
```

## Test Procedure

1. Connect hardware per diagram above (see safety_notes.md first!)
2. Run `python scripts/encryption_test.py` to verify crypto
3. Run `python scripts/generate_test_vectors.py` to create reference vectors
4. Open `gnuradio/loopback_full.grc` in GNU Radio Companion
5. Execute BER sweep: `python scripts/run_loopback_test.py`
6. Compare results: `python scripts/measure_implementation_loss.py`

## Test Frequencies

| Band | Center Freq | Notes |
|------|------------|-------|
| S-band (primary) | 2200 MHz | Spacecraft TT&C band |
| UHF (alternative) | 437 MHz | CubeSat amateur |
| L-band | 1694 MHz | GOES cross-validation |
