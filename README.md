# GROUNDLINK

**LEO Satellite Communications — Test & Validation Platform**

A 5-phase SDR-based project demonstrating end-to-end spacecraft communications engineering: from link budget analysis through real satellite reception, CCSDS waveform implementation, over-the-air validation, and a web-based monitoring dashboard.

## Project Phases

| Phase | Title | Key Deliverable |
|-------|-------|----------------|
| 1 | Link Budget Engine | Python link budget tool validated against CCSDS references |
| 2 | SDR Ground Station | GOES LRIT reception, predicted vs measured C/N₀ validation |
| 3 | CCSDS TM Waveform | GNU Radio CCSDS modem, BER vs Eb/N₀ curves |
| 4 | Over-the-Air Loopback | SDR hardware TX/RX, AES-256 encryption, ICD document |
| 5 | Integration Dashboard | Next.js dashboard, GitHub repo, blog series |

## Hardware

- **Antenna:** Repurposed DirecTV Slimline 5 dish (51×61 cm oval) with custom L-band feed
- **LNA:** Nooelec SAWbird+ GOES (NF 0.5 dB, Gain 34 dB)
- **SDR (RX):** RTL-SDR Blog V4
- **SDR (TX):** ADALM-Pluto (Phase 4)
- **Total cost:** ~$90 (Phases 1–3) / ~$305 (full build)

## Quick Start

### Phase 1 — Link Budget Engine

```bash
cd phase1_link_budget
pip install -r requirements.txt
pytest tests/ -v
python cli.py geo --sat-lon -137.2 --freq 1694.1e6 --eirp 42 \
    --rx-gain 12.5 --tsys 105 --symbol-rate 293e3 --modulation bpsk
```

### Phase 5 — Dashboard

```bash
cd phase5_dashboard
npm install
npm run dev
```

## License

MIT
