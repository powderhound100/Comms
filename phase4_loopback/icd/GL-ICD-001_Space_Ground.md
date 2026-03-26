# GL-ICD-001: GROUNDLINK Space-to-Ground Interface Control Document

**Document Number:** GL-ICD-001
**Revision:** A
**Date:** 2026-03-24
**Status:** Draft

---

## 1. Scope

This document defines the interface between the GROUNDLINK spacecraft transmitter
and the ground station receiver. It specifies the RF, channel coding, frame
structure, encryption, and timing interfaces required for interoperable
space-to-ground telemetry communication.

## 2. Applicable Documents

| ID | Title |
|----|-------|
| CCSDS 131.0-B | TM Synchronization and Channel Coding |
| CCSDS 132.0-B | TM Space Data Link Protocol |
| CCSDS 401.0-B | Radio Frequency and Modulation Systems |
| ITU-R P.676 | Attenuation by Atmospheric Gases |
| ITU-R P.618 | Propagation Data for Earth-Space Telecommunication |

## 3. RF Interface

### 3.1 Frequency Plan

| Parameter | Value | Notes |
|-----------|-------|-------|
| Downlink Frequency | 2200 MHz | S-band TT&C allocation |
| Alternative 1 | 1694.1 MHz | L-band (GOES cross-validation) |
| Alternative 2 | 437 MHz | UHF CubeSat amateur |
| Channel Bandwidth | 400 kHz | At 256 ksps, α=0.35 |

### 3.2 Modulation Parameters

| Parameter | Value |
|-----------|-------|
| Modulation | BPSK (primary), QPSK (secondary) |
| Symbol Rate | 256,000 symbols/sec |
| Pulse Shaping | Root Raised Cosine |
| Roll-off Factor (α) | 0.35 |
| Occupied Bandwidth | 256 × (1 + 0.35) = 345.6 kHz |

### 3.3 Power Levels

| Parameter | Value |
|-----------|-------|
| TX Output Power (PlutoSDR) | 0 dBm max |
| Attenuator | 30 dB (mandatory for loopback) |
| RX Input Level | -30 dBm nominal |
| RX Dynamic Range | -80 to -10 dBm |

### 3.4 Polarization

Linear (loopback test configuration). Operational spacecraft would use RHCP.

### 3.5 Doppler Range

| Parameter | Value |
|-----------|-------|
| Maximum Doppler (LEO 830 km) | ±40 kHz at 1.7 GHz |
| Maximum Doppler Rate | 600 Hz/s |
| Receiver Acquisition Range | ±50 kHz |

## 4. Channel Coding Interface

### 4.1 Inner Code (Convolutional)

| Parameter | Value |
|-----------|-------|
| Type | Convolutional |
| Rate | 1/2 |
| Constraint Length | 7 |
| Generator Polynomial G1 | 0x6D (1101101) |
| Generator Polynomial G2 | 0x4F (1001111) |
| Decoding | Viterbi, soft-decision |
| Traceback Depth | 35 (5 × k) |

### 4.2 Outer Code (Optional)

| Parameter | Value |
|-----------|-------|
| Type | Reed-Solomon |
| Configuration | RS(255, 223) |
| Symbol Size | 8 bits |
| Correction Capability | 16 symbols |
| Interleaving Depth | 5 |

### 4.3 Randomization

| Parameter | Value |
|-----------|-------|
| LFSR Polynomial | x⁸ + x⁷ + x⁵ + x³ + 1 |
| Initial State | 0xFF |
| Reset | At each frame boundary |
| ASM | Not randomized |

### 4.4 Synchronization (ASM)

| Parameter | Value |
|-----------|-------|
| Pattern | 0x1ACFFC1D |
| Length | 32 bits |
| Detection Threshold | 31/32 bits (1-bit error tolerance) |
| Position | Prepended to each coded frame |

## 5. Frame Structure

### 5.1 Transfer Frame Format

```
[ASM 32b][Header 48b][Data Field variable][CRC 16b]
```

Total frame: 8920 bits (1115 bytes) excluding ASM.

### 5.2 Frame Header Fields

| Field | Bits | Description |
|-------|------|-------------|
| Version | 2 | Always 00 |
| Spacecraft ID | 10 | Identifies source |
| Virtual Channel ID | 3 | Multiplexing channel |
| OCF Flag | 1 | Operational Control Field |
| Frame Counter | 16 | Sequential, wraps at 65535 |
| Frame Length | 16 | Total frame length - 1 |

### 5.3 CRC Specification

| Parameter | Value |
|-----------|-------|
| Algorithm | CRC-16-CCITT |
| Polynomial | x¹⁶ + x¹² + x⁵ + 1 (0x1021) |
| Initial Value | 0xFFFF |
| Scope | Header + Data Field |

### 5.4 Frame Numbering

Frame counter increments by 1 for each transmitted frame per virtual channel.
Wraps from 65535 to 0. Receiver shall detect gaps for link quality monitoring.

## 6. Encryption Interface

### 6.1 Algorithm

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256 |
| Mode | CTR (Counter) |
| Key Length | 256 bits (32 bytes) |
| Block Size | 128 bits (16 bytes) |

### 6.2 Key Management

Simplified key management for demonstration. In operational systems, EKMS with
NSA Type 1 algorithms would replace AES-256.

### 6.3 Nonce Handling

- 16-byte nonce prepended to encrypted frame data field
- Unique nonce per frame (random generation)
- Nonce is transmitted in the clear within the frame header extension

### 6.4 Protocol Stack Position

```
Application Data → AES-256-CTR Encrypt → CCSDS Framing → FEC Encode → Randomize → Modulate → RF
```

## 7. Timing Interface

### 7.1 Symbol Rate and Tolerance

| Parameter | Value |
|-----------|-------|
| Nominal Symbol Rate | 256,000 sps |
| Tolerance | ±5 ppm |
| Clock Recovery | Mueller & Müller |
| Loop Bandwidth | 2π/100 |

### 7.2 Frame Timing

| Parameter | Value |
|-----------|-------|
| Frame Duration | 1115 × 8 / (256000 × 0.5) = 69.7 ms (coded) |
| Frames per Second | ~14.3 |

### 7.3 Acquisition Sequence

1. Carrier acquisition (Costas loop lock, < 200 ms)
2. Symbol timing acquisition (M&M loop, < 100 ms)
3. ASM detection (< 3 frames)
4. Frame sync achieved

## 8. Test and Verification

### 8.1 Compliance Matrix

| Requirement | Test Method | Pass Criteria |
|-------------|-------------|---------------|
| BER at design Eb/N₀ | Loopback BER sweep | BER < 10⁻⁵ |
| Implementation loss | Sim vs OTA comparison | < 2.0 dB |
| Encryption integrity | Round-trip test | Zero errors |
| Wrong-key rejection | Decrypt with wrong key | 100% corruption |
| Frame sync acquisition | Cold-start test | < 3 frames |
| Doppler tracking | LEO channel sim | < 0.5 dB degradation |

### 8.2 Test Vectors

Test vectors are provided in `data/test_vectors/test_vectors.json` covering:
- CRC-16 computation
- CCSDS frame assembly
- Randomizer sequence
- AES-256-CTR encryption
