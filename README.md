# GROUNDLINK

### Full-spectrum SDR platform — AI signal classification, live aircraft tracking, multi-protocol decoding, and satellite imagery in one real-time dashboard.

**GROUNDLINK** is a 7-phase SDR-based platform covering end-to-end RF engineering: link budget analysis, real satellite reception, CCSDS waveform design, encrypted over-the-air loopback, deep learning signal classification, multi-protocol decoding, and a live web dashboard.

---

## What Makes This Different

GROUNDLINK is a production-grade signals intelligence and communications engineering platform built around the RTL-SDR. Every RF number is validated against CCSDS references. Every link budget is cross-checked with real measurements. The AI classifies modulations in real time. The dashboard streams live spectrum, aircraft positions, and decoded protocols over WebSocket — all from a single SDR device managed by an intelligent switching agent.

---

## Key Features

### SDR Switching Agent — One Dongle, Three Missions

One RTL-SDR device, three completely different operational modes — switchable with a single click from the dashboard.

The **SDR Agent** (`phase7_scan_detect/sdr_agent.py`) is a lightweight HTTP process manager that gives the dashboard full control over the hardware:

- **Three modes**: `radio` (live FM/AM/NFM receiver), `scanner` (wideband spectrum sweep with AI classification), `adsb` (live aircraft tracking)
- **Automatic switching**: Gracefully stops the current backend, releases the USB device (800ms cooldown), spawns the new mode — all transparently behind a single API call
- **Process lifecycle**: PID tracking, uptime monitoring, rolling log buffer, and clean process tree teardown
- **Zero config**: `POST /api/sdr/start {"mode": "adsb"}` — the agent builds the command, sets PATH, spawns the subprocess, and streams logs back

```
POST /api/sdr/start   →  { mode: "radio" | "scanner" | "adsb", config: {...} }
POST /api/sdr/stop    →  {}
GET  /api/sdr         →  { active_mode, pid, uptime_s, log }
```

---

### Live Aircraft Tracking (ADS-B)

A full pipeline from RF at 1090 MHz to map pins in the browser:

- **Custom C decoder** (`groundlink_adsb.exe`) — magnitude computation, preamble correlation, CRC-24 verification, and Mode S message decoding at wire speed
- **Binary frame protocol** between C and Python — no JSON overhead in the hot path. Three frame types: `D` (decoded aircraft), `S` (spectrum), `M` (raw hex)
- **WebSocket streaming** at ~1 update/sec: ICAO hex, callsign, lat/lon, altitude, ground speed, heading, vertical rate, squawk, on-ground status
- **CPR position decoding** with even/odd frame caching for Compact Position Reporting
- **Live interactive map** in the dashboard via Leaflet with position trails

---

### Full-Spectrum Scanner with AI Signal Recognition

The scanner is a six-layer signal processing pipeline covering **24 MHz to 1.766 GHz**:

| Layer | Component | What It Does |
|-------|-----------|-------------|
| 1 | **SDR Backend** | Hardware abstraction with mock mode, configurable gain/rate/correction |
| 2 | **Energy Detector** | FFT-based detection, configurable threshold, optional CFAR |
| 3 | **AI Classifier** | Deep learning AMR — classifies 11 modulation types in real time |
| 4 | **Demodulator** | WFM, NFM, AM demod with audio capture and voice detection |
| 5 | **Protocol Decoder** | Extracts usable data: aircraft positions, pager messages, ship tracks, satellite imagery |
| 6 | **Known Signal Catalog** | 40+ pre-loaded signatures — aviation, maritime, amateur, emergency, satellite |

**AI Models** (Phase 6):
- **VT-CNN2** — O'Shea et al. Conv1d baseline, 85%+ accuracy at high SNR
- **ResNet1d** — Deeper residual network with BatchNorm
- Trained on **RadioML 2016.10a** (220K samples, 11 modulations, -20 to +18 dB SNR)
- Modulations: BPSK, QPSK, 8PSK, AM-DSB, AM-SSB, WBFM, CPFSK, GFSK, PAM4, QAM16, QAM64

**Scan Modes**:
- **Sweep** — Continuous 24–1766 MHz scan
- **Watch** — Park on a single frequency for persistent monitoring
- **Band List** — Define custom band segments to hop between

---

### Multi-Protocol Decoding

The protocol decoder automatically identifies and extracts data from detected signals:

| Protocol | Frequency | What You Get |
|----------|-----------|-------------|
| **ADS-B** | 1090 MHz | Aircraft ICAO, callsign, position, altitude, velocity |
| **NOAA APT** | 137.1 / 137.62 / 137.9 MHz | Weather satellite imagery (via SatDump) |
| **Meteor-M2 LRPT** | 137.1 MHz | Satellite imagery pipeline |
| **GOES LRIT/HRIT** | 1694.1 MHz | Geostationary weather satellite data |
| **APRS** | 144.39 MHz | Amateur radio positions, callsigns, status |
| **POCSAG** | 152.48 MHz | Pager address and message text |
| **AIS** | 161.975 / 162.025 MHz | Ship tracking (channels 1 & 2) |
| **ACARS** | 129–131 MHz | Aircraft data link messages |

---

## All 7 Phases

| Phase | Title | Key Deliverable |
|-------|-------|----------------|
| **1** | **Link Budget Engine** | Python CLI validated against CCSDS references — orbital mechanics, atmospheric attenuation (ITU-R P.676/P.618), antenna patterns, noise temperature, modulation-specific BER |
| **2** | **SDR Ground Station** | GOES-18 LRIT reception with predicted vs. measured C/N₀ validation |
| **3** | **CCSDS TM Waveform** | GNU Radio OOT modem — convolutional coding (r=1/2, k=7), RS(255,223), CCSDS randomizer, ASM correlator, BER vs. Eb/N₀ curves |
| **4** | **Over-the-Air Loopback** | PlutoSDR TX + RTL-SDR RX, AES-256-GCM encryption, and a formal Interface Control Document (GL-ICD-001) |
| **5** | **Integration Dashboard** | Next.js + Tailwind real-time dashboard with 15+ pages, WebSocket streaming, Docker + Cloudflare tunnel |
| **6** | **Signal Recognition** | Deep learning AMR — VTCNN2 and ResNet1d trained on RadioML 2016.10a, integrated into live scanner |
| **7** | **Scan & Detect** | Wideband scanner, SDR switching agent, ADS-B tracker, protocol decoders, known signal catalog |

---

## Dashboard

A **Next.js + Tailwind** web interface with real-time WebSocket streaming:

| Page | Description |
|------|------------|
| **Radio** | Live FM/AM/NFM receiver with spectrum visualizer and audio playback |
| **Scan & Detect** | Real-time waterfall, detection log, AI classification results |
| **ADS-B** | Live aircraft map with position tracking and trails |
| **Signal Recognition** | AMR training results, BER curves, confusion matrices |
| **Imagery** | Satellite image gallery — NOAA, GOES, Meteor decodes |
| **Link Budget** | Interactive calculator for LEO/GEO scenarios |
| **GNU Radio** | CCSDS modem flowgraphs and configuration |
| **Ground Station** | Hardware setup, pass predictions, SNR measurements |
| **Modem** | Waveform spec, BER vs. Eb/N₀, modulation comparison |
| **Sessions** | Historical scan log with detection database |
| **ICD** | Space-to-ground interface control document |

The **SDR Mode Bar** at the top switches between Radio / Scanner / ADS-B with one click.

---

## Hardware

| Component | Model | Specs |
|-----------|-------|-------|
| **Antenna** | DirecTV Slimline 5 (repurposed) | 51 x 61 cm oval, custom L-band feed |
| **LNA** | Nooelec SAWbird+ GOES | NF 0.5 dB, Gain 34 dB |
| **SDR (RX)** | RTL-SDR Blog V4 | 24–1766 MHz, 2.4 Msps, 8-bit ADC |
| **SDR (TX)** | ADALM-Pluto | 325–3800 MHz, 12-bit DAC (Phase 4) |

---

## Quick Start

### Link Budget Engine
```bash
cd phase1_link_budget
pip install -r requirements.txt
pytest tests/ -v
python cli.py geo --sat-lon -137.2 --freq 1694.1e6 --eirp 42 \
    --rx-gain 12.5 --tsys 105 --symbol-rate 293e3 --modulation bpsk
```

### Dashboard
```bash
cd phase5_dashboard
npm install
npm run dev
```

### Docker (Dashboard + Cloudflare Tunnel)
```bash
docker compose up -d
```

### Scanner (Mock Mode — No Hardware)
```bash
cd phase7_scan_detect
pip install -r requirements.txt
python scanner.py --mock --mode sweep
```

### ADS-B Tracker
```bash
cd phase7_scan_detect
python adsb_server.py --port 8771 --gain 496
```

### SDR Agent (Process Manager)
```bash
cd phase7_scan_detect
python sdr_agent.py --port 8780
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Next.js Dashboard (Phase 5)               │
│   Radio ┃ Scan & Detect ┃ ADS-B ┃ Imagery ┃ Link Budget    │
│                      ┃ SDR Mode Bar ┃                        │
└──────────────────────┬───────────────────────────────────────┘
                       │ WebSocket + HTTP
┌──────────────────────┴───────────────────────────────────────┐
│                SDR Switching Agent (Phase 7)                  │
│          POST /api/sdr/start { mode: "..." }                 │
├──────────────┬────────────────┬───────────────────────────────┤
│  radio_server│    scanner     │     adsb_server               │
│  (C backend) │                │     (C backend)               │
│  WFM/NFM/AM  │  Energy Det.   │     1090 MHz Mode S           │
│  audio stream│  AI Classifier │     CRC-24 + CPR decode       │
│              │  Demodulator   │     Aircraft state table       │
│              │  Protocol Dec. │                               │
│              │  Signal Catalog│                               │
└──────┬───────┴───────┬────────┴──────────┬────────────────────┘
       │               │                   │
       └───────────────┴───────────────────┘
                       │
              ┌────────┴────────┐
              │   RTL-SDR V4    │
              │  24–1766 MHz    │
              └─────────────────┘
```

---

## Repository Structure

```
├── phase1_link_budget/       # Python link budget engine + CLI
├── phase2_ground_station/    # GOES LRIT reception, hardware validation
├── phase3_ccsds_modem/       # GNU Radio CCSDS OOT module
├── phase4_loopback/          # OTA loopback, AES-256, ICD
├── phase5_dashboard/         # Next.js real-time dashboard
├── phase6_signal_recognition/# AMR deep learning models
├── phase7_scan_detect/       # Scanner, SDR agent, ADS-B, decoders
├── cloudflared/              # Cloudflare tunnel config
├── docker-compose.yml        # Dashboard + tunnel deployment
└── README.md
```

---

## License

MIT
