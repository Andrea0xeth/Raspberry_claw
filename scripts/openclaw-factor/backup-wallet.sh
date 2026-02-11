#!/usr/bin/env bash
# Backup wallet and Factor MCP config before OpenClaw reset.
# Restore after new install: copy keystores/ and factor-mcp/ from BACKUP_DIR back to ~/.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/openclaw-wallet-backup-$(date +%Y%m%d)}"
mkdir -p "$BACKUP_DIR"
cd "$BACKUP_DIR"

echo "Backing up to $BACKUP_DIR"

if [ -d "$HOME/.foundry/keystores" ]; then
  cp -a "$HOME/.foundry/keystores" ./
  echo "  - .foundry/keystores"
fi

if [ -d "$HOME/.factor-mcp" ]; then
  cp -a "$HOME/.factor-mcp" ./
  echo "  - .factor-mcp"
elif [ -f "$HOME/.factor-mcp/config.json" ]; then
  mkdir -p factor-mcp
  cp "$HOME/.factor-mcp/config.json" factor-mcp/ 2>/dev/null || true
  echo "  - .factor-mcp/config.json"
fi

echo "Done. To restore after reinstall:"
echo "  [ -d $BACKUP_DIR/keystores ] && cp -a $BACKUP_DIR/keystores \$HOME/.foundry/"
echo "  [ -d $BACKUP_DIR/factor-mcp ] && cp -a $BACKUP_DIR/factor-mcp \$HOME/.factor-mcp"
