#!/usr/bin/env bash
# Copy factor-strategies skill into OpenClaw skills directory.
# Default: ~/.clawdbot/skills . Override with OPENCLAW_SKILLS_DIR.
# Run from repo root (Raspberry_claw).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SKILL_SRC="$REPO_ROOT/.cursor/skills/factor-strategies"
SKILLS_DIR="${OPENCLAW_SKILLS_DIR:-$HOME/.clawdbot/skills}"

if [ ! -d "$SKILL_SRC" ] || [ ! -f "$SKILL_SRC/SKILL.md" ]; then
  echo "Error: factor-strategies skill not found at $SKILL_SRC (run from repo root)."
  exit 1
fi

mkdir -p "$SKILLS_DIR"
cp -r "$SKILL_SRC" "$SKILLS_DIR/factor-strategies"
echo "Installed factor-strategies to $SKILLS_DIR/factor-strategies"
echo "Restart OpenClaw gateway so the skill loads: openclaw gateway restart"
