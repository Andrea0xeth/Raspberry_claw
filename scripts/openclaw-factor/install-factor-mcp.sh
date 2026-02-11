#!/usr/bin/env bash
# Install Factor MCP and print OpenClaw MCP config snippet.
# Requires Node 18+.

set -euo pipefail

INSTALL_DIR="${FACTOR_MCP_DIR:-$HOME/factor-mcp}"

if [ -f "$INSTALL_DIR/dist/index.js" ]; then
  echo "Using existing Factor MCP at $INSTALL_DIR"
  ENTRYPOINT="$INSTALL_DIR/dist/index.js"
elif command -v curl &>/dev/null; then
  echo "Installing Factor MCP via official install script..."
  curl -sSL https://raw.githubusercontent.com/FactorDAO/factor-mcp/main/install.sh | bash
  ENTRYPOINT=$(which factor-mcp 2>/dev/null || true)
  if [ -z "$ENTRYPOINT" ] && [ -f "$INSTALL_DIR/dist/index.js" ]; then
    ENTRYPOINT="$INSTALL_DIR/dist/index.js"
  elif [ -z "$ENTRYPOINT" ]; then
    ENTRYPOINT="$HOME/factor-mcp/dist/index.js"
    echo "Set FACTOR_MCP_DIR to the install path if different."
  fi
else
  echo "Cloning and building Factor MCP in $INSTALL_DIR..."
  git clone https://github.com/FactorDAO/factor-mcp.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  npm install
  npm run build
  ENTRYPOINT="$INSTALL_DIR/dist/index.js"
fi

[ -z "$ENTRYPOINT" ] && ENTRYPOINT="$INSTALL_DIR/dist/index.js"

echo "--- Add this to your OpenClaw MCP config (e.g. ~/.openclaw/openclaw.json or ~/.clawdbot config) ---"
echo "\"mcpServers\": {"
echo "  \"factor\": {"
echo "    \"command\": \"node\","
echo "    \"args\": [\"$ENTRYPOINT\"],"
echo "    \"env\": {"
echo "      \"ALCHEMY_API_KEY\": \"<your_alchemy_key>\","
echo "      \"DEFAULT_CHAIN\": \"ARBITRUM_ONE\""
echo "    }"
echo "  }"
echo "}"
echo "--- Then restart OpenClaw gateway ---"
