# GROUNDLINK — Claude Code Instructions

## Raspberry Pi Access

The Pi (SDR-Pi-Cameron, 10.0.0.245) is accessible via PiLink (`D:/PiLink`). **Always use PiLink** for Pi operations — never SSH manually.

```bash
bash D:/PiLink/pilink.sh ping              # Test connectivity
bash D:/PiLink/pilink.sh exec "command"    # Run any command on Pi
bash D:/PiLink/pilink.sh read /path/file   # Read remote file
bash D:/PiLink/pilink.sh write /path/file  # Write stdin to remote file (base64-safe)
bash D:/PiLink/pilink.sh edit /path/file "old" "new"  # Sed replacement
bash D:/PiLink/pilink.sh logs [n]          # Journalctl last n lines (default 50)
bash D:/PiLink/pilink.sh status            # Service + system info
bash D:/PiLink/pilink.sh restart           # Restart groundlink-pi service
bash D:/PiLink/pilink.sh deploy            # OTA: git pull → build → restart
bash D:/PiLink/pilink.sh push local remote # SCP file to Pi
bash D:/PiLink/pilink.sh pull remote local # SCP file from Pi
```

- The Pi runs `groundlink-pi.service` from `/opt/groundlink/`
- Three RTL-SDR dongles: GROUNDLINK_1090 (ADS-B), GROUNDLINK_978 (UAT), GL_RADIO (FM/scanner)
- Pi user: `cambaugh96`, has passwordless sudo
