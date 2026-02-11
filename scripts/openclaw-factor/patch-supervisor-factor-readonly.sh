#!/usr/bin/env bash
###############################################################################
# patch-supervisor-factor-readonly.sh
# Run on the Pi (as user that can write /opt/openclaw/src, or with sudo).
# Patches /opt/openclaw/src/index.js so the Supervisor has read-only Factor
# access and can answer "our vault" without delegating to the defi worker.
#
# Usage on Pi:
#   sudo bash scripts/openclaw-factor/patch-supervisor-factor-readonly.sh
#
# From Mac (after sync):
#   ssh piclaw 'cd Raspberry_claw && sudo bash scripts/openclaw-factor/patch-supervisor-factor-readonly.sh'
###############################################################################
set -euo pipefail

INDEX_JS="${INDEX_JS:-/opt/openclaw/src/index.js}"
BACKUP="${INDEX_JS}.bak.supervisor-$(date +%Y%m%d%H%M%S)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
log()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; }

if [ ! -f "$INDEX_JS" ]; then
  err "Not found: $INDEX_JS"
  exit 1
fi

echo "Patch Supervisor: add Factor read-only (factor, eth_balance) and update prompt"
echo "  File: $INDEX_JS"
echo "  Backup: $BACKUP"
echo ""

# Backup
cp -a "$INDEX_JS" "$BACKUP"
log "Backup: $BACKUP"

# 1) Add factor and eth_balance to SUPERVISOR_TOOLS
#    From: const SUPERVISOR_TOOLS = { agent_status: tools.agent_status, agent_journal: tools.agent_journal };
#    To:   const SUPERVISOR_TOOLS = { agent_status: tools.agent_status, agent_journal: tools.agent_journal, factor: tools.factor, eth_balance: tools.eth_balance };
if grep -q 'SUPERVISOR_TOOLS = { agent_status: tools.agent_status, agent_journal: tools.agent_journal, factor: tools.factor' "$INDEX_JS"; then
  warn "SUPERVISOR_TOOLS already includes factor/eth_balance; skipping."
else
  sed -i 's/const SUPERVISOR_TOOLS = { agent_status: tools.agent_status, agent_journal: tools.agent_journal };/const SUPERVISOR_TOOLS = { agent_status: tools.agent_status, agent_journal: tools.agent_journal, factor: tools.factor, eth_balance: tools.eth_balance };/' "$INDEX_JS"
  log "SUPERVISOR_TOOLS updated (factor + eth_balance)."
fi

# 2) Update SUPERVISOR_PROMPT: allow read-only Factor, list direct tools
#    Replace "NEVER call factor_* or shell tools yourself" with text that allows read-only Factor.
#    Replace "DIRECT TOOLS: agent_status, agent_journal" with text that includes factor/eth_balance for read-only.
OLD_NEVER="- NEVER call factor_\* or shell tools yourself"
NEW_NEVER="- For read-only Factor checks (our vault, vault list, shares, config) use Factor tools directly (factor_get_owned_vaults, factor_get_vault_info, factor_get_shares, factor_get_config). For execution (deposit, withdraw, execute_manager) delegate to defi. Do not call shell yourself."
if grep -q "For read-only Factor checks" "$INDEX_JS"; then
  warn "SUPERVISOR_PROMPT already updated for read-only Factor; skipping."
else
  # One-line safe replace: the prompt is in a template literal; we replace the single rule line.
  sed -i 's/- NEVER call factor_\* or shell tools yourself/- For read-only Factor checks (our vault, vault list, shares, config) use Factor tools directly (factor_get_owned_vaults, factor_get_vault_info, factor_get_shares, factor_get_config). For execution (deposit, withdraw, execute_manager) delegate to defi. Do not call shell yourself./' "$INDEX_JS"
  log "SUPERVISOR_PROMPT updated (read-only Factor allowed)."
fi

if grep -q "DIRECT TOOLS: agent_status, agent_journal, factor" "$INDEX_JS"; then
  warn "DIRECT TOOLS line already updated; skipping."
else
  sed -i 's/DIRECT TOOLS: agent_status, agent_journal`;/DIRECT TOOLS: agent_status, agent_journal, factor (read-only vault\/config\/shares), eth_balance`;/' "$INDEX_JS"
  log "DIRECT TOOLS line updated."
fi

echo ""
log "Patch done. Restart OpenClaw: sudo systemctl restart openclaw"
echo "  To revert: sudo cp $BACKUP $INDEX_JS && sudo systemctl restart openclaw"
echo ""
