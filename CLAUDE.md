# GROUNDLINK — Claude Code Instructions

## Raspberry Pi Access

The Pi (SDR-Pi-Cameron, 10.0.0.245) is accessible via SSH pipeline. **Always use `tools/pi.sh`** for Pi operations — never SSH manually.

```bash
bash tools/pi.sh ping              # Test connectivity
bash tools/pi.sh exec "command"    # Run any command on Pi
bash tools/pi.sh read /path/file   # Read remote file
bash tools/pi.sh write /path/file  # Write stdin to remote file (base64-safe)
bash tools/pi.sh edit /path/file "old" "new"  # Sed replacement
bash tools/pi.sh logs [n]          # Journalctl last n lines (default 50)
bash tools/pi.sh status            # Service + system info
bash tools/pi.sh restart           # Restart groundlink-pi service
bash tools/pi.sh deploy            # OTA: git pull → copy → rebuild → restart
bash tools/pi.sh push local remote # SCP file to Pi
bash tools/pi.sh pull remote local # SCP file from Pi
```

- The Pi runs `groundlink-pi.service` from `/opt/groundlink/`
- Three RTL-SDR dongles: GROUNDLINK_1090 (ADS-B), GROUNDLINK_978 (UAT), GL_RADIO (FM/scanner)
- Pi user: `cambaugh96`, has passwordless sudo
