#!/bin/bash
# Quick health check for GROUNDLINK Pi SDR node
echo "=== GROUNDLINK Pi Health Check ==="

# CPU temperature
if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
    TEMP=$(cat /sys/class/thermal/thermal_zone0/temp)
    TEMP_C=$(echo "scale=1; $TEMP / 1000" | bc)
    echo "CPU Temperature: ${TEMP_C}°C"
    if [ "$TEMP" -gt 80000 ]; then
        echo "  WARNING: Temperature exceeds 80°C!"
    fi
else
    echo "CPU Temperature: N/A"
fi

# Throttling
if command -v vcgencmd &>/dev/null; then
    THROTTLED=$(vcgencmd get_throttled | cut -d= -f2)
    if [ "$THROTTLED" = "0x0" ]; then
        echo "Throttling: None"
    else
        echo "Throttling: ACTIVE ($THROTTLED)"
    fi
fi

# USB devices
echo ""
echo "RTL-SDR devices:"
rtl_test -t 2>&1 | head -10

# Pi agent status
echo ""
echo "Pi Agent service:"
systemctl is-active groundlink-pi 2>/dev/null || echo "not running"

# Memory
echo ""
echo "Memory:"
free -h | head -2

# CPU
echo ""
echo "CPU load:"
uptime
