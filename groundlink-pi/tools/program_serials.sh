#!/bin/bash
# Program unique serial numbers onto each RTL-SDR dongle.
# Run with ONE dongle plugged in at a time.
set -e

echo "GROUNDLINK Dongle Serial Programmer"
echo ""
echo "Plug in ONLY the dongle you want to program, then press Enter."
echo ""

read -p "Which dongle? [1090/978/radio]: " DONGLE

case $DONGLE in
    1090)  SERIAL="GROUNDLINK_1090" ;;
    978)   SERIAL="GROUNDLINK_978"  ;;
    radio) SERIAL="GROUNDLINK_RADIO" ;;
    *)     echo "Unknown dongle type: $DONGLE"; exit 1 ;;
esac

echo "Programming serial: $SERIAL"
rtl_eeprom -s "$SERIAL"
echo ""
echo "Done! Unplug this dongle and repeat for the next one."
