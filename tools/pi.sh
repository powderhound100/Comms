#!/usr/bin/env bash
# pi.sh — SSH pipeline wrapper for Raspberry Pi (groundlink node)
# Usage: bash tools/pi.sh <command> [args...]

set -euo pipefail

SSH_HOST="pi"
SSH="ssh $SSH_HOST"

usage() {
    cat <<'USAGE'
Usage: pi.sh <command> [args...]

Commands:
  ping                  Test SSH connectivity
  exec "cmd"            Run command on Pi
  read /path/file       Print remote file contents
  write /path/file      Write stdin to remote file (base64-safe)
  edit /path/file "old" "new"  Sed replacement on remote file
  logs [n]              Journalctl last n lines (default 50)
  status                Service status + system info
  restart               Restart groundlink-pi service
  deploy                Full OTA: git pull → copy → rebuild → restart
  push local remote     SCP file to Pi
  pull remote local     SCP file from Pi
USAGE
    exit 1
}

cmd_ping() {
    $SSH "echo 'SSH OK — $(hostname) — $(date)'"
}

cmd_exec() {
    [[ $# -lt 1 ]] && { echo "Usage: pi.sh exec \"command\""; exit 1; }
    $SSH "$*"
}

cmd_read() {
    [[ $# -lt 1 ]] && { echo "Usage: pi.sh read /path/to/file"; exit 1; }
    $SSH "cat '$1'"
}

cmd_write() {
    [[ $# -lt 1 ]] && { echo "Usage: pi.sh write /path/to/file  (reads stdin)"; exit 1; }
    local remote_path="$1"
    local encoded
    encoded=$(base64 -w0)
    $SSH "echo '$encoded' | base64 -d > '$remote_path'"
}

cmd_edit() {
    [[ $# -lt 3 ]] && { echo "Usage: pi.sh edit /path/to/file \"old\" \"new\""; exit 1; }
    local file="$1"
    local old="$2"
    local new="$3"
    # Escape sed special characters
    local old_escaped new_escaped
    old_escaped=$(printf '%s\n' "$old" | sed 's/[&/\]/\\&/g; s/$/\\/' | sed '$ s/\\$//')
    new_escaped=$(printf '%s\n' "$new" | sed 's/[&/\]/\\&/g; s/$/\\/' | sed '$ s/\\$//')
    $SSH "sed -i 's/${old_escaped}/${new_escaped}/g' '$file'"
}

cmd_logs() {
    local lines="${1:-50}"
    $SSH "sudo journalctl -u groundlink-pi --no-pager -n $lines"
}

cmd_status() {
    $SSH bash -s <<'REMOTE'
echo "=== Service Status ==="
sudo systemctl status groundlink-pi --no-pager 2>/dev/null || echo "groundlink-pi service not found"
echo ""
echo "=== System Info ==="
echo "Hostname: $(hostname)"
echo "Uptime:  $(uptime -p)"
echo "Kernel:  $(uname -r)"
echo "Temp:    $(vcgencmd measure_temp 2>/dev/null || echo 'N/A')"
echo "Memory:  $(free -h | awk '/Mem:/{print $3 "/" $2}')"
echo "Disk:    $(df -h / | awk 'NR==2{print $3 "/" $2 " (" $5 " used)"}')"
echo ""
echo "=== Network ==="
ip -4 addr show | grep -oP 'inet \K[\d.]+/\d+' | head -5
echo ""
echo "=== Processes (groundlink) ==="
ps aux | grep -i groundlink | grep -v grep || echo "No groundlink processes running"
REMOTE
}

cmd_restart() {
    $SSH "sudo systemctl restart groundlink-pi && echo 'Service restarted' && sudo systemctl status groundlink-pi --no-pager"
}

cmd_deploy() {
    echo "=== OTA Deploy Starting ==="
    $SSH bash -s <<'REMOTE'
set -e
echo "[1/4] Git pull..."
cd /opt/groundlink && sudo git pull

echo "[2/4] Copying files..."
# If there's a groundlink-pi source dir, copy from it
if [ -d /opt/groundlink/groundlink-pi ]; then
    sudo cp -r /opt/groundlink/groundlink-pi/* /opt/groundlink/
fi

echo "[3/4] Building C decoders..."
if [ -f /opt/groundlink/build.sh ]; then
    cd /opt/groundlink && sudo bash build.sh
else
    echo "No build.sh found, skipping C build"
fi

echo "[4/4] Restarting service..."
sudo systemctl restart groundlink-pi
sleep 2
sudo systemctl status groundlink-pi --no-pager
echo ""
echo "=== Deploy Complete ==="
REMOTE
}

cmd_push() {
    [[ $# -lt 2 ]] && { echo "Usage: pi.sh push local_file remote_path"; exit 1; }
    scp -F ~/.ssh/config "$1" "pi:$2"
}

cmd_pull() {
    [[ $# -lt 2 ]] && { echo "Usage: pi.sh pull remote_path local_file"; exit 1; }
    scp -F ~/.ssh/config "pi:$1" "$2"
}

# --- Main dispatcher ---
[[ $# -lt 1 ]] && usage

command="$1"
shift

case "$command" in
    ping)    cmd_ping ;;
    exec)    cmd_exec "$@" ;;
    read)    cmd_read "$@" ;;
    write)   cmd_write "$@" ;;
    edit)    cmd_edit "$@" ;;
    logs)    cmd_logs "$@" ;;
    status)  cmd_status ;;
    restart) cmd_restart ;;
    deploy)  cmd_deploy ;;
    push)    cmd_push "$@" ;;
    pull)    cmd_pull "$@" ;;
    *)       echo "Unknown command: $command"; usage ;;
esac
