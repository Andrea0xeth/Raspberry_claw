#!/usr/bin/env bash
###############################################################################
# from-mac-deploy-to-pi.sh
# From Mac: sync repo to Pi and run run-all-on-pi.sh (backup + Factor MCP + skill).
# Requires SSH on port 2222 (default). E.g. ssh -p 2222 piclaw
#
# Usage:
#   cd /path/to/Raspberry_claw
#   bash scripts/openclaw-factor/from-mac-deploy-to-pi.sh
#
#   # Different port/host:
#   PI_PORT=2222 PI_HOST=piclaw.local bash scripts/openclaw-factor/from-mac-deploy-to-pi.sh
#   PI_HOST=192.168.1.50 PI_USER=pi PI_PORT=2222 bash scripts/openclaw-factor/from-mac-deploy-to-pi.sh
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PI_HOST="${PI_HOST:-piclaw}"
PI_USER="${PI_USER:-pi}"
PI_PORT="${PI_PORT:-2222}"
REMOTE_DIR="${REMOTE_DIR:-Raspberry_claw}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

echo ""
echo "  Deploy OpenClaw+Factor to Pi: sync + run-all-on-pi.sh"
echo "  Target: ${PI_USER}@${PI_HOST}:${PI_PORT} (${REMOTE_DIR})"
echo ""

# Test SSH
info "Testing SSH connection..."
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes -p "$PI_PORT" "${PI_USER}@${PI_HOST}" "echo OK" &>/dev/null; then
  err "Cannot connect to ${PI_USER}@${PI_HOST}:${PI_PORT}. Check:"
  echo "   - ssh -p ${PI_PORT} ${PI_USER}@${PI_HOST}"
  echo "   - Or: PI_HOST=piclaw.local PI_PORT=2222"
  exit 1
fi
log "SSH OK"

# Sync (skill + scripts)
info "Syncing files to Pi..."
ssh -p "$PI_PORT" "${PI_USER}@${PI_HOST}" "mkdir -p ${REMOTE_DIR}/.cursor/skills ${REMOTE_DIR}/scripts ${REMOTE_DIR}/docs"
rsync -az --no-perms -e "ssh -p $PI_PORT" \
  "$REPO_ROOT/.cursor/skills/factor-strategies" \
  "${PI_USER}@${PI_HOST}:${REMOTE_DIR}/.cursor/skills/"
rsync -az --no-perms -e "ssh -p $PI_PORT" \
  "$REPO_ROOT/scripts/openclaw-factor" \
  "${PI_USER}@${PI_HOST}:${REMOTE_DIR}/scripts/"
[ -f "$REPO_ROOT/docs/OPENCLAW-FACTOR-SETUP.md" ] && rsync -az --no-perms -e "ssh -p $PI_PORT" \
  "$REPO_ROOT/docs/OPENCLAW-FACTOR-SETUP.md" \
  "${PI_USER}@${PI_HOST}:${REMOTE_DIR}/docs/"
log "Files synced"

# Run on Pi (REPO_ROOT on Pi = home/REMOTE_DIR)
info "Running run-all-on-pi.sh on Pi..."
ssh -t -p "$PI_PORT" "${PI_USER}@${PI_HOST}" "cd ${REMOTE_DIR} && REPO_ROOT=\$(pwd) bash scripts/openclaw-factor/run-all-on-pi.sh"

log "Done."
echo ""
