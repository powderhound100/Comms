#!/bin/bash
# GROUNDLINK Pi SDR Node — One-Shot Setup
# Run as: sudo bash setup.sh
set -euo pipefail

INSTALL_DIR="/opt/groundlink"
VENV_DIR="$INSTALL_DIR/venv"
PI_USER="${SUDO_USER:-pi}"

echo "============================================"
echo " GROUNDLINK Pi SDR Node Setup"
echo "============================================"

# ── Step 1: System Packages ──────────────────────
echo ""
echo "[1/8] Installing system packages..."
apt-get update
apt-get install -y \
    build-essential \
    cmake \
    git \
    librtlsdr-dev \
    rtl-sdr \
    libusb-1.0-0-dev \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    avahi-daemon \
    avahi-utils \
    libitpp-dev \
    libsndfile1-dev \
    libncurses-dev \
    libpulse-dev

# ── Step 2: Install Directory ─────────────────────
echo ""
echo "[2/8] Setting up $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp -r . "$INSTALL_DIR/"
chown -R "$PI_USER:$PI_USER" "$INSTALL_DIR"

# ── Step 3: Blacklist DVB-T Kernel Driver ─────────
echo ""
echo "[3/8] Blacklisting conflicting DVB-T kernel driver..."
cat > /etc/modprobe.d/blacklist-rtlsdr.conf << 'MODCONF'
# Prevent kernel DVB-T driver from claiming RTL-SDR devices
blacklist dvb_usb_rtl28xxu
blacklist rtl2832
blacklist rtl2830
blacklist dvb_usb_v2
blacklist dvb_core
MODCONF
modprobe -r dvb_usb_rtl28xxu 2>/dev/null || true

# ── Step 4: udev Rules (non-root SDR access) ─────
echo ""
echo "[4/8] Installing udev rules for non-root SDR access..."
cp "$INSTALL_DIR/udev/99-rtlsdr.rules" /etc/udev/rules.d/
udevadm control --reload-rules
udevadm trigger

# ── Step 5: Build C Decoders ─────────────────────
echo ""
echo "[5/8] Compiling C decoders for ARM..."
cd "$INSTALL_DIR/c_decoders"
sudo -u "$PI_USER" bash build.sh

# ── Step 6a: Build libmbe (required by DSD-FME) ──
echo ""
echo "[6/8] Building libmbe + DSD-FME for P25 support..."
if ! ldconfig -p | grep -q libmbe; then
    echo "  Building libmbe (AMBE/IMBE codec)..."
    cd /tmp
    rm -rf mbelib
    wget -q https://github.com/lwvmobile/mbelib/archive/refs/heads/ambe_tones.tar.gz
    tar xzf ambe_tones.tar.gz
    cd mbelib-ambe_tones
    mkdir -p build && cd build
    cmake ..
    make -j"$(nproc)"
    make install
    ldconfig
    echo "  -> libmbe installed"
else
    echo "  -> libmbe already installed"
fi

# ── Step 6b: Build DSD-FME (P25 decoder) ─────────
if ! command -v dsd-fme &>/dev/null; then
    echo "  Building DSD-FME..."
    cd /tmp
    rm -rf dsd-fme
    git clone https://github.com/lwvmobile/dsd-fme.git
    cd dsd-fme
    mkdir -p build && cd build
    cmake ..
    make -j"$(nproc)"
    make install
    ldconfig
    echo "  -> dsd-fme installed at $(which dsd-fme)"
else
    echo "  -> dsd-fme already installed"
fi

# ── Step 7: Python Virtual Environment ────────────
echo ""
echo "[7/8] Setting up Python virtual environment..."
sudo -u "$PI_USER" python3 -m venv "$VENV_DIR"
sudo -u "$PI_USER" "$VENV_DIR/bin/pip" install --upgrade pip
sudo -u "$PI_USER" "$VENV_DIR/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

# ── Step 8: Systemd Service ──────────────────────
echo ""
echo "[8/8] Installing systemd service..."
# Patch service file with actual username (default template uses 'pi')
sed "s/User=pi/User=$PI_USER/; s/Group=pi/Group=$PI_USER/" \
    "$INSTALL_DIR/systemd/groundlink-pi.service" \
    > /etc/systemd/system/groundlink-pi.service
systemctl daemon-reload
systemctl enable groundlink-pi

echo ""
echo "============================================"
echo " Setup Complete!"
echo ""
echo " Next steps:"
echo "   1. Edit $INSTALL_DIR/config.toml"
echo "      - Set [windows].host to your PC's IP"
echo "   2. Program dongle serials:"
echo "      sudo bash $INSTALL_DIR/tools/program_serials.sh"
echo "   3. Reboot (to apply kernel driver blacklist):"
echo "      sudo reboot"
echo "   4. After reboot, service starts automatically:"
echo "      sudo systemctl status groundlink-pi"
echo "============================================"
