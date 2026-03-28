# GROUNDLINK Quick Reference Commands

## Windows Side

### Start Everything (after reboot)
```batch
REM 1. Start Docker (dashboard + cloudflare tunnel)
docker compose up -d

REM 2. Start SDR agent in dual ADS-B mode
REM    (or just double-click start_pi_sdr.bat)
cd D:\Comms\phase7_scan_detect
python sdr_agent.py --port 8780

REM 3. In another terminal, switch to dual mode
curl -X POST http://localhost:8780/api/sdr/start -H "Content-Type: application/json" -d "{\"mode\": \"adsb_dual\"}"
```

### One-Click Startup
```
Double-click: D:\Comms\start_pi_sdr.bat
```

### Check Status
```batch
REM SDR agent status
curl http://localhost:8780/api/sdr

REM Pi health (proxied through agent)
curl http://localhost:8780/api/pi/health

REM Pi status (direct)
curl http://10.0.0.245:8781/api/pi/status

REM Dashboard
open http://localhost:3001/ads-b
```

### Rebuild Dashboard (after code changes)
```batch
docker compose build --no-cache groundlink-dashboard
docker compose up -d groundlink-dashboard
```

## Pi Side (via SSH)

### Connect
```bash
ssh cambaugh96@SDR-pi-Cameron.local
```

### Service Control
```bash
sudo systemctl status groundlink-pi     # check status
sudo systemctl restart groundlink-pi    # restart
sudo systemctl stop groundlink-pi       # stop
sudo systemctl start groundlink-pi      # start
sudo journalctl -u groundlink-pi -n 30 --no-pager  # logs
```

### Check Health
```bash
curl http://localhost:8781/api/pi/health
curl http://localhost:8781/api/pi/status | python3 -m json.tool
```

### Slot Logs
```bash
curl -s http://localhost:8781/api/pi/sdr/0/log | python3 -m json.tool  # 1090 MHz
curl -s http://localhost:8781/api/pi/sdr/1/log | python3 -m json.tool  # 978 MHz
curl -s http://localhost:8781/api/pi/sdr/2/log | python3 -m json.tool  # Radio
```

### Start/Stop Slot 2 (Radio)
```bash
# Start P25 radio
curl -X POST http://localhost:8781/api/pi/sdr/2/start \
  -H "Content-Type: application/json" \
  -d '{"mode": "radio", "config": {"freq": 154800000, "radio_mode": "p25"}}'

# Stop
curl -X POST http://localhost:8781/api/pi/sdr/2/stop
```

### Update Pi Code (OTA)
```bash
cd ~/groundlink && git pull
sudo cp -r groundlink-pi/* /opt/groundlink/
sudo systemctl restart groundlink-pi
```

### SDR Diagnostics
```bash
rtl_test -t 2>&1 | head -10                    # detect dongles
rtl_eeprom -d 0 2>&1 | grep Serial             # check serial
sudo bash /opt/groundlink/tools/test_sdrs.sh    # full test
sudo bash /opt/groundlink/tools/check_health.sh # system health
```

## Network Info
| Device     | IP           | Key Ports          |
|------------|--------------|---------------------|
| Windows PC | 10.0.0.236   | 8780, 8771, 3001    |
| Pi         | 10.0.0.245   | 8781, 9001, 9002    |

## SDR Dongle Map
| Serial          | Slot | Frequency | Function         |
|-----------------|------|-----------|------------------|
| GROUNDLINK_1090 | 0    | 1090 MHz  | ADS-B Mode S     |
| GROUNDLINK_978  | 1    | 978 MHz   | ADS-B UAT        |
| GL_RADIO        | 2    | Flexible  | P25/FM/AM/Scan   |

## Pi Auto-Starts on Boot
No commands needed — the systemd service starts `pi_agent.py` automatically,
which starts Slot 0 and Slot 1 with a 3-second stagger.
