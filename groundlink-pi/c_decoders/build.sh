#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "=== Building GROUNDLINK C decoders for ARM Linux ==="

# 1090 MHz ADS-B decoder
echo "[1/3] groundlink_adsb..."
gcc -O2 -Wall -Wextra -o groundlink_adsb groundlink_adsb.c \
    -lrtlsdr -lm -lpthread
echo "  -> groundlink_adsb OK"

# 978 MHz UAT decoder
echo "[2/3] groundlink_uat..."
gcc -O2 -Wall -Wextra -o groundlink_uat groundlink_uat.c \
    -lrtlsdr -lm -lpthread
echo "  -> groundlink_uat OK"

# Radio demodulator (WFM/NFM/AM/Discriminator)
echo "[3/3] groundlink_radio..."
gcc -O2 -Wall -Wextra -o groundlink_radio groundlink_radio.c \
    -lrtlsdr -lm -lpthread
echo "  -> groundlink_radio OK"

echo ""
echo "All binaries built successfully."
ls -la groundlink_adsb groundlink_uat groundlink_radio
