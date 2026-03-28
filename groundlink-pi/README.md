# GROUNDLINK Pi SDR Node

Multi-SDR Raspberry Pi 4B node for GROUNDLINK. Runs 3 RTL-SDR dongles in
parallel and streams data to the Windows host over WiFi.

## SDR Slots

| Slot | Dongle Serial    | Frequency | Function                       |
|------|------------------|-----------|--------------------------------|
| 0    | GROUNDLINK_1090  | 1090 MHz  | ADS-B Mode S (always on)       |
| 1    | GROUNDLINK_978   | 978 MHz   | ADS-B UAT (always on)          |
| 2    | GL_RADIO         | < 200 MHz | P25 / FM / AM / Scanner (flex) |

## Prerequisites

- Raspberry Pi 4B (4GB+ RAM recommended)
- 3x RTL-SDR Blog V4 dongles
- microSD card (16GB+) flashed with **Raspberry Pi OS Lite (64-bit)**
- Ethernet or WiFi connection to your Windows host
- Active cooling (fan/heatsink case) — 3 SDRs generate significant heat

### Flashing the SD Card

1. Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Choose OS: **Raspberry Pi OS (other)** > **Raspberry Pi OS Lite (64-bit)**
3. Click **Edit Settings** before writing:
   - Set hostname, username, password
   - Configure WiFi (or skip if using ethernet)
   - **Services tab**: Enable SSH with password authentication
4. Write to SD card, insert into Pi, boot

## Quick Start

```bash
# 1. SSH into the Pi
ssh youruser@yourpi.local

# 2. Update system (takes 10-30 min on first run)
sudo apt update && sudo apt upgrade -y

# 3. Clone repo
git clone https://github.com/powderhound100/Comms.git ~/groundlink

# 4. Run installer (takes ~15 min, builds C decoders + DSD-FME)
cd ~/groundlink/groundlink-pi
sudo bash setup.sh

# 5. Edit config — set your Windows PC's IP
sudo nano /opt/groundlink/config.toml
# Change: host = "YOUR_WINDOWS_IP" under [windows]

# 6. Program dongle serials (see below)

# 7. Reboot
sudo reboot

# 8. Check status
sudo systemctl status groundlink-pi
curl http://localhost:8781/api/pi/health
```

## Programming Dongle Serials

Each RTL-SDR dongle needs a unique serial so the Pi can address them
independently. **Program one dongle at a time** — unplug the other two.

The RTL-SDR EEPROM has a **15-character limit** on serial numbers.

```bash
# Plug in ONLY the first dongle
sudo rtl_eeprom -s GROUNDLINK_1090
# Type 'y' to confirm, then UNPLUG this dongle

# Plug in ONLY the second dongle
sudo rtl_eeprom -s GROUNDLINK_978
# Type 'y', then UNPLUG

# Plug in ONLY the third dongle
sudo rtl_eeprom -s GL_RADIO
# Type 'y', then UNPLUG
```

Plug all 3 back in and verify:
```bash
sudo bash /opt/groundlink/tools/test_sdrs.sh
```

You should see all 3 detected with their unique serial numbers.

## Updating

Since the Pi is on your network, update over SSH anytime:

```bash
ssh youruser@yourpi.local
cd ~/groundlink && git pull
sudo cp -r groundlink-pi/* /opt/groundlink/
sudo systemctl restart groundlink-pi
```

## Architecture

```
Pi (WiFi/Ethernet)                 Windows Host
+--------------------------+       +------------------------+
| pi_agent.py :8781        |       | sdr_agent.py :8780     |
|   Slot 0: adsb 1090      |--TCP->|   adsb_server.py       |
|   Slot 1: uat 978         |--TCP->|     :9001 + :9002      |
|   Slot 2: radio/scan      |--WS-->|   Dashboard :3001      |
+--------------------------+       +------------------------+
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

## Troubleshooting

### DSD-FME build fails with missing libraries
The setup script installs all required dependencies, but if you hit cmake
errors about missing packages:
```bash
sudo apt install -y libncurses-dev libpulse-dev libitpp-dev libsndfile1-dev
```

### libmbe not found
DSD-FME requires libmbe (AMBE/IMBE codec). The setup script builds it
automatically, but if needed manually:
```bash
cd /tmp
wget https://github.com/lwvmobile/mbelib/archive/refs/heads/ambe_tones.tar.gz
tar xzf ambe_tones.tar.gz
cd mbelib-ambe_tones && mkdir build && cd build
cmake .. && make -j$(nproc) && sudo make install && sudo ldconfig
```

### Serial programming says "string too long"
RTL-SDR EEPROM serial limit is 15 characters. Use shorter names (e.g.
`GL_RADIO` instead of `GROUNDLINK_RADIO`).

### Dongles not detected
- Check USB connections and try different ports
- Ensure DVB-T driver is blacklisted: `cat /etc/modprobe.d/blacklist-rtlsdr.conf`
- Reboot after blacklisting
- Run `rtl_test -t` to check detection

### git clone asks for password on public repos
Clear cached credentials: `git config --global --unset credential.helper`
Or use wget: `wget https://github.com/user/repo/archive/refs/heads/main.tar.gz`

## Ports

| Port | Service           |
|------|-------------------|
| 8781 | Pi Agent HTTP     |
| 8770 | Radio WebSocket   |
| 8765 | Scanner WebSocket |
| 8766 | Scanner REST API  |
| 9001 | ADS-B 1090 TCP    |
| 9002 | ADS-B 978 TCP     |
