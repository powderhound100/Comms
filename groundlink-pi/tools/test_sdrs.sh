#!/bin/bash
# Verify all 3 RTL-SDR dongles are detected.
echo "Checking RTL-SDR devices..."
echo ""

echo "Detected devices:"
rtl_test -t 2>&1 | head -20

echo ""
echo "Checking serial numbers..."
for i in 0 1 2; do
    SERIAL=$(rtl_eeprom -d $i 2>&1 | grep "Serial number" | awk '{print $NF}' || echo "NOT FOUND")
    echo "  Device $i: $SERIAL"
done

echo ""
echo "Quick read test (2 seconds each)..."
for SERIAL in GL_1090 GL_978 GL_RADIO; do
    echo -n "  $SERIAL: "
    if timeout 2 rtl_test -d "$SERIAL" 2>&1 | grep -q "Sampling"; then
        echo "OK"
    else
        echo "FAILED"
    fi
done
