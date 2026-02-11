#!/usr/bin/env bash
###############################################################################
# run-all-on-pi.sh
# Run on Raspberry Pi: backup wallet → install Factor MCP → install skill.
# OpenClaw install (--beta, no sub-agent) is done manually once.
#
# On the Pi (after copying repo or git pull):
#   cd /path/to/Raspberry_claw
#   bash scripts/openclaw-factor/run-all-on-pi.sh
#
# From Mac (when ssh piclaw works):
#   cd /path/to/Raspberry_claw
#   rsync -avz --exclude .git . piclaw:Raspberry_claw/
#   ssh piclaw 'cd Raspberry_claw && bash scripts/openclaw-factor/run-all-on-pi.sh'
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SKILL_SRC="$REPO_ROOT/.cursor/skills/factor-strategies"

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
echo "  OpenClaw + Factor: backup wallet, install Factor MCP, install skill"
echo ""

# ─── 1. Backup wallet ───────────────────────────────────────────────────────
info "Step 1/3: Backup wallet..."
bash "$SCRIPT_DIR/backup-wallet.sh"
BACKUP_DIR="${BACKUP_DIR:-$HOME/openclaw-wallet-backup-$(date +%Y%m%d)}"
log "Wallet backup done: $BACKUP_DIR"

# ─── 2. Install Factor MCP ─────────────────────────────────────────────────
info "Step 2/3: Install Factor MCP..."
if command -v node &>/dev/null && [[ $(node -p 'process.versions.node.split(".")[0]') -ge 18 ]]; then
  if [ -d "${FACTOR_MCP_DIR:-$HOME/factor-mcp}/dist" ]; then
    log "Factor MCP already built at ${FACTOR_MCP_DIR:-$HOME/factor-mcp}"
  else
    bash "$SCRIPT_DIR/install-factor-mcp.sh" || true
  fi
  echo ""
  info "Add the MCP block above to OpenClaw config and set ALCHEMY_API_KEY."
else
  warn "Node 18+ not found or not in PATH; skipping Factor MCP install. Install Node and re-run."
fi

# ─── 3. Install factor-strategies skill ───────────────────────────────────
info "Step 3/3: Install factor-strategies skill..."
SKILLS_DIR="${OPENCLAW_SKILLS_DIR:-$HOME/.clawdbot/skills}"
if [ -z "${OPENCLAW_SKILLS_DIR:-}" ]; then
  mkdir -p "$HOME/.clawdbot/skills"
  SKILLS_DIR="$HOME/.clawdbot/skills"
fi
if [ -d "$SKILL_SRC" ] && [ -f "$SKILL_SRC/SKILL.md" ]; then
  mkdir -p "$SKILLS_DIR"
  cp -r "$SKILL_SRC" "$SKILLS_DIR/factor-strategies"
  log "Skill installed to $SKILLS_DIR/factor-strategies"
else
  err "Skill not found at $SKILL_SRC (run from repo root)."
  exit 1
fi

echo ""
log "Done. Next:"
echo "  1. Install OpenClaw (if not yet): curl -fsSL https://openclaw.ai/install.sh | bash -s -- --beta"
echo "  2. In OpenClaw config, disable sub-agent (only main agent)."
echo "  3. Restore wallet from $BACKUP_DIR if you reinstalled OpenClaw."
echo "  4. Add Factor MCP to OpenClaw MCP config (see output above)."
echo "  5. Enable full control (terminal + browser) in OpenClaw config."
echo "  6. Restart gateway: openclaw gateway restart  (or clawdbot gateway restart)"
echo ""
