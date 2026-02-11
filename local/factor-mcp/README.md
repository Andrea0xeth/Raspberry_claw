# Factor MCP — local copy (not in git)

Copy config and wallets from `~/.factor-mcp/` here to keep them in the project locally.

```bash
# Run from repo root (Raspberry_claw)
mkdir -p local/factor-mcp/wallets
cp ~/.factor-mcp/config.json local/factor-mcp/ 2>/dev/null || true
cp ~/.factor-mcp/wallets/*.json local/factor-mcp/wallets/ 2>/dev/null || true
```

- `config.json` and `wallets/` are in **.gitignore** (they contain keys and sensitive data).
- To restore on the Pi or another machine: copy this folder’s contents to `~/.factor-mcp/` (or `/root/.factor-mcp/` on the Pi if services run as root).
