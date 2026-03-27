# GROUNDLINK Pi SDR Node

Multi-SDR Raspberry Pi 4B node for GROUNDLINK. Runs 3 RTL-SDR dongles in
parallel and streams data to the Windows host over WiFi.

## SDR Slots

| Slot | Dongle Serial    | Frequency | Function                       |
|------|------------------|-----------|--------------------------------|
| 0    | GROUNDLINK_1090  | 1090 MHz  | ADS-B Mode S (always on)       |
| 1    | GROUNDLINK_978   | 978 MHz   | ADS-B UAT (always on)          |
| 2    | GROUNDLINK_RADIO | < 200 MHz | P25 / FM / AM / Scanner (flex) |

## Quick Start

```bash
# 1. Clone repo to Pi
git clone <repo> /tmp/groundlink
cd /tmp/groundlink/groundlink-pi

# 2. Run installer (as root)
sudo bash setup.sh

# 3. Edit config
sudo nano /opt/groundlink/config.toml
# Set [windows].host to your Windows PC's IP

# 4. Program dongle serials (one at a time)
sudo bash /opt/groundlink/tools/program_serials.sh

# 5. Reboot
sudo reboot

# 6. Check status
sudo systemctl status groundlink-pi
curl http://localhost:8781/api/pi/health
```

## Architecture

```
Pi (WiFi)                          Windows Host
┌────────────────────────┐         ┌──────────────────────┐
│ pi_agent.py :8781      │         │ sdr_agent.py :8780   │
│   Slot 0: adsb 1090    │──TCP──→ │   adsb_server.py     │
│   Slot 1: uat 978      │──TCP──→ │     :9001 + :9002    │
│   Slot 2: radio/scan   │──WS───→ │   Dashboard :3001    │
└────────────────────────┘         └──────────────────────┘
```

## API

- `GET  /api/pi/status` — Full status with all 3 slots
- `GET  /api/pi/health` — Quick health (temp, throttle, USB count)
- `POST /api/pi/sdr/{slot}/start` — Start slot with mode + config
- `POST /api/pi/sdr/{slot}/stop` — Stop slot
- `GET  /api/pi/sdr/{slot}/log` — Last 80 log lines

## Building C Decoders

```bash
cd /opt/groundlink/c_decoders
make all    # or: bash build.sh
```

Requires: `librtlsdr-dev`, `build-essential`

## Ports

| Port | Service           |
|------|-------------------|
| 8781 | Pi Agent HTTP     |
| 8770 | Radio WebSocket   |
| 8765 | Scanner WebSocket |
| 8766 | Scanner REST API  |
| 9001 | ADS-B 1090 TCP →  |
| 9002 | ADS-B 978 TCP →   |
