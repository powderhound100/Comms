#!/usr/bin/env bash
# GROUNDLINK Pi Setup — Installs dependencies for multi-SDR fleet deployment
#
# Run on a fresh Raspberry Pi (Bookworm or later):
#   curl -sSL <this-script> | bash
#   -- or --
#   chmod +x pi-setup.sh && ./pi-setup.sh
#
# Prerequisites: Raspberry Pi OS (64-bit), internet access, 4x RTL-SDR dongles

set -euo pipefail

echo "=============================================="
echo "  GROUNDLINK SDR Fleet — Pi Setup"
echo "=============================================="

# ── System packages ──
echo "[1/6] Installing system packages..."
sudo apt-get update
sudo apt-get install -y \
    build-essential cmake pkg-config \
    libusb-1.0-0-dev \
    python3 python3-pip python3-venv \
    git udev

# ── RTL-SDR drivers ──
echo "[2/6] Installing RTL-SDR drivers..."
if ! command -v rtl_test &>/dev/null; then
    cd /tmp
    git clone https://github.com/rtlsdrblog/rtl-sdr-blog.git
    cd rtl-sdr-blog
    mkdir -p build && cd build
    cmake .. -DINSTALL_UDEV_RULES=ON -DDETACH_KERNEL_DRIVER=ON
    make -j$(nproc)
    sudo make install
    sudo ldconfig
    cd /tmp && rm -rf rtl-sdr-blog
    echo "RTL-SDR drivers installed."
else
    echo "RTL-SDR drivers already installed."
fi

# ── Blacklist kernel DVB-T driver (conflicts with RTL-SDR) ──
echo "[3/6] Configuring kernel modules..."
if ! grep -q "blacklist dvb_usb_rtl28xxu" /etc/modprobe.d/blacklist-rtlsdr.conf 2>/dev/null; then
    sudo tee /etc/modprobe.d/blacklist-rtlsdr.conf > /dev/null << 'BLACKLIST'
blacklist dvb_usb_rtl28xxu
blacklist rtl2832
blacklist rtl2830
BLACKLIST
    echo "Kernel DVB-T drivers blacklisted."
fi

# ── udev rules for stable device ordering ──
echo "[4/6] Installing udev rules..."
sudo cp "$(dirname "$0")/udev/rtl-sdr.rules" /etc/udev/rules.d/99-rtl-sdr.rules 2>/dev/null || \
    sudo tee /etc/udev/rules.d/99-rtl-sdr.rules > /dev/null << 'UDEV'
# GROUNDLINK — RTL-SDR device permissions
# Allows non-root access to RTL-SDR USB devices
SUBSYSTEM=="usb", ATTRS{idVendor}=="0bda", ATTRS{idProduct}=="2838", MODE="0666"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0bda", ATTRS{idProduct}=="2832", MODE="0666"
UDEV

sudo udevadm control --reload-rules
sudo udevadm trigger
echo "udev rules installed."

# ── Python environment ──
echo "[5/6] Setting up Python environment..."
FLEET_DIR="${HOME}/groundlink-fleet"
mkdir -p "${FLEET_DIR}"

if [ ! -d "${FLEET_DIR}/venv" ]; then
    python3 -m venv "${FLEET_DIR}/venv"
fi

source "${FLEET_DIR}/venv/bin/activate"
pip install --upgrade pip
pip install \
    paho-mqtt>=2.0 \
    pyrtlsdr>=0.3.0 \
    aiohttp>=3.9 \
    websockets>=12.0 \
    click>=8.0 \
    pyyaml>=6.0 \
    numpy>=1.24

echo "Python packages installed in ${FLEET_DIR}/venv"

# ── Systemd service ──
echo "[6/6] Installing systemd service..."
sudo tee /etc/systemd/system/groundlink-fleet.service > /dev/null << SERVICE
[Unit]
Description=GROUNDLINK SDR Fleet Manager
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${FLEET_DIR}
Environment=PATH=${FLEET_DIR}/venv/bin:/usr/local/bin:/usr/bin
Environment=RTLSDR_DIR=/usr/local/lib
ExecStart=${FLEET_DIR}/venv/bin/python sdr_fleet.py --config fleet_config.yaml
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
echo "Systemd service installed (groundlink-fleet.service)"

echo ""
echo "=============================================="
echo "  Setup Complete!"
echo "=============================================="
echo ""
echo "Next steps:"
echo "  1. Copy phase7_scan_detect/ to ${FLEET_DIR}/"
echo "  2. Edit ${FLEET_DIR}/fleet_config.yaml"
echo "     - Set MQTT broker IP to your Docker host"
echo "     - Configure SDR device assignments"
echo "  3. Plug in 4x RTL-SDR dongles"
echo "  4. Test: rtl_test -d 0  (repeat for -d 1, -d 2, -d 3)"
echo "  5. Start: sudo systemctl enable --now groundlink-fleet"
echo "  6. Logs:  journalctl -u groundlink-fleet -f"
echo ""
