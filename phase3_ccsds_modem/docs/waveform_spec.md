# GROUNDLINK Waveform Specification

## Modulation & Coding

| Parameter | Value |
|-----------|-------|
| Modulation | BPSK (primary) / QPSK (secondary) |
| Symbol Rate | 256 ksps (configurable) |
| Pulse Shaping | Root Raised Cosine, α = 0.35 |
| Inner Code | Convolutional r=1/2, k=7 (CCSDS polys G1=0x6D, G2=0x4F) |
| Outer Code | Reed-Solomon (255, 223) — optional |
| ASM | 0x1ACFFC1D (32-bit CCSDS) |
| Randomization | CCSDS LFSR (x⁸+x⁷+x⁵+x³+1, init=0xFF) |
| Frame Length | 8920 bits (1115 bytes) |

## Transfer Frame Format

```
[ASM 32b][Header 48b][Data Field][CRC 16b]
```

### Header Fields (6 bytes)
- Version (2 bits): 00
- Spacecraft ID (10 bits)
- Virtual Channel ID (3 bits)
- OCF Flag (1 bit)
- Frame Counter (16 bits)
- Frame Length (16 bits)

## Coding Configurations

| Config | Inner Code | Outer Code | Coding Gain @ BER 10⁻⁵ |
|--------|-----------|------------|------------------------|
| A | Conv r=1/2, k=7 | None | ~5.0 dB |
| B | Conv r=1/2, k=7 | RS(255,223) | ~7.0 dB |
| C | None (uncoded) | None | 0 dB |
| D | Conv r=3/4 | None | ~3.5 dB |

## Channel Model (LEO)

| Parameter | Value |
|-----------|-------|
| Max Doppler | ±40 kHz @ 1.7 GHz |
| Doppler Rate | ~600 Hz/s max |
| Clock Offset | 2–5 ppm |
| Phase Noise | −80 dBc/Hz @ 10 kHz |
