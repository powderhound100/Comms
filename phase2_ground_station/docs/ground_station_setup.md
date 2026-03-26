# GROUNDLINK Ground Station Setup Guide

## Hardware Components

| Component | Model | Specification |
|-----------|-------|--------------|
| Antenna | DirecTV Slimline 5 | 51×61 cm offset parabolic |
| Feed | Custom L-band cantenna | 130 mm dia, SMA connector |
| LNA | Nooelec SAWbird+ GOES | NF 0.5 dB, Gain 34 dB |
| SDR | RTL-SDR Blog V4 | TCXO, bias-T, 500 kHz–1.766 GHz |

## Assembly Steps

### 1. Dish Preparation
- Remove existing Ku-band LNB sled (4 bolts on arm assembly)
- Keep arm bracket — it marks the focal point position
- Clean reflector surface
- Verify J-mount mechanical stability

### 2. L-Band Feed Fabrication
Run `python hardware/feed_dimensions.py` for exact dimensions.

- Source a tin can or copper pipe with ~130 mm inner diameter
- Drill hole for SMA bulkhead connector at λ/4 from closed end
- Solder center conductor extension to form 44 mm probe
- For RHCP: add second probe at 90° with 90° phase shift
  (or accept 3 dB polarization loss with linear probe)

### 3. Signal Chain
```
Feed → SMA cable (<30cm) → SAWbird+ GOES → RTL-SDR V4 → USB → PC
                                              (bias-T ON)
```

### 4. Pointing (GOES-18)
- Azimuth: ~200° true (Seattle)
- Elevation: ~33°
- Fine-adjust using SDR spectrum display to maximize signal

## Software Setup

```bash
pip install -r requirements.txt
python scripts/predict_pass.py --satellite GOES-18
python scripts/capture_session.py --satellite GOES-18 --duration 120
```

## Signal Chain Budget

| Stage | Gain | NF | T_noise |
|-------|------|----|---------|
| Antenna + Feed | — | — | 50 K |
| SAWbird+ LNA | +34 dB | 0.5 dB | 35 K |
| RTL-SDR V4 | +42 dB | 4.5 dB | <0.1 K |
| **System Total** | | | **~105 K** |
