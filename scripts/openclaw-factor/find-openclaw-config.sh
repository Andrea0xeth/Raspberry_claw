#!/usr/bin/env bash
# Run on the Pi (or OpenClaw host) to find config files and show delegation/sub-agent keys.
# Usage: bash scripts/openclaw-factor/find-openclaw-config.sh

set -euo pipefail

echo "=== OpenClaw / Clawbot config locations ==="
for dir in "$HOME/.clawdbot" "$HOME/.openclaw" "/opt/openclaw" "/opt/clawdbot"; do
  [ -d "$dir" ] && echo "  $dir" && find "$dir" -maxdepth 3 -type f \( -name "*.json" -o -name "*.yaml" -o -name "*.yml" \) 2>/dev/null
done

echo ""
echo "=== Checking for delegation / sub-agent / workers keys ==="
for cfg in \
  "$HOME/.clawdbot/clawdbot.json" \
  "$HOME/.openclaw/openclaw.json" \
  "/opt/openclaw/config/clawdbot.json" \
  "/opt/openclaw/config/openclaw.json"; do
  if [ -f "$cfg" ]; then
    echo "  File: $cfg"
    if command -v jq &>/dev/null; then
      jq -r 'keys[]' "$cfg" 2>/dev/null | while read -r k; do
        case "$k" in
          *delegat*|*subagent*|*sub_agent*|*worker*|*agents*) echo "    key: $k";;
        esac
      done
      for key in delegations subAgents sub_agents workers agents; do
        if jq -e ".\"$key\"" "$cfg" &>/dev/null; then
          echo "    $key: $(jq -c ".\"$key\"" "$cfg" 2>/dev/null | head -c 200)"
        fi
      done
    else
      grep -E "delegat|subagent|sub_agent|worker|agents" "$cfg" 2>/dev/null | head -20 || true
    fi
    echo ""
  fi
done

echo "=== Done. Disable sub-agents in the config above so the main agent uses Factor MCP directly. ==="
