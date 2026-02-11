#!/usr/bin/env bash
# Install passwordless sudo for user openclaw (limited to openclaw service and unit file).
# Run on the Pi: sudo bash install-openclaw-sudo.sh
# From Mac: scp script + sudoers to Pi, then ssh and run with sudo.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUDOERS_SRC="${SCRIPT_DIR}/openclaw-sudoers"
SUDOERS_DEST="/etc/sudoers.d/openclaw"

if [ ! -f "$SUDOERS_SRC" ]; then
  echo "Missing $SUDOERS_SRC (run from repo or copy openclaw-sudoers to Pi first)"
  exit 1
fi

cp "$SUDOERS_SRC" "$SUDOERS_DEST"
chmod 440 "$SUDOERS_DEST"
visudo -c -f "$SUDOERS_DEST" || { rm -f "$SUDOERS_DEST"; exit 1; }
echo "Installed $SUDOERS_DEST. User openclaw can now run (without password):"
echo "  systemctl start|stop|restart|status openclaw, systemctl daemon-reload,"
echo "  cp /tmp/openclaw.service.new /etc/systemd/system/openclaw.service"
