# OpenClaw setup: fresh install + Factor MCP + factor-strategies skill

This guide configures OpenClaw so that it:

1. **Runs a new version with memory reset** but **keeps the wallet** (backup before, restore after).
2. **Has full control** of the PC: terminal and browser.
3. **Has Factor MCP installed** and the **factor-strategies skill** (full lifecycle, Stats API, user vaults, reference).

Use this on the machine where OpenClaw runs (e.g. your NAS or main PC). Scripts in `scripts/openclaw-factor/` automate backup, Factor MCP install, and skill install.

---

## 1. Backup the wallet (before any reset)

Factor MCP stores the wallet in one of these places:

- **Foundry Keystore (default):** `~/.foundry/keystores/`
- **Factor-MCP legacy:** `~/.factor-mcp/wallets/`

OpenClaw may store config and data under `~/.clawdbot/` or `~/.openclaw/`. Back up those too if you want to restore settings later (we only restore wallet-related data after reset).

**Backup (run as the user that runs OpenClaw):**

```bash
BACKUP_DIR=~/openclaw-wallet-backup-$(date +%Y%m%d)
mkdir -p "$BACKUP_DIR"
[ -d ~/.foundry/keystores ] && cp -a ~/.foundry/keystores "$BACKUP_DIR/"
[ -d ~/.factor-mcp ] && cp -a ~/.factor-mcp "$BACKUP_DIR/"
[ -f ~/.factor-mcp/config.json ] && cp -a ~/.factor-mcp/config.json "$BACKUP_DIR/" 2>/dev/null || true
echo "Backup in $BACKUP_DIR"
```

Or use the script (from repo root):

```bash
chmod +x scripts/openclaw-factor/*.sh  # once
bash scripts/openclaw-factor/backup-wallet.sh
```

Keep the backup safe. After the new OpenClaw install and Factor MCP install, restore only the wallet (and optionally Factor config):

```bash
# Restore Foundry keystores
[ -d "$BACKUP_DIR/keystores" ] && cp -a "$BACKUP_DIR/keystores" ~/.foundry/
# Restore Factor-MCP wallets/config
[ -d "$BACKUP_DIR/factor-mcp" ] && cp -a "$BACKUP_DIR/factor-mcp" ~/.factor-mcp
[ -f "$BACKUP_DIR/config.json" ] && cp "$BACKUP_DIR/config.json" ~/.factor-mcp/
```

---

## 2. New OpenClaw install (reset memory, no sub-agent)

Install the new version with **beta** and **without sub-agent** (only the main agent):

```bash
curl -fsSL https://openclaw.ai/install.sh | bash -s -- --beta
```

If the installer supports a “no sub-agent” or “single agent” option, enable it during onboarding or in config. After install:

- Run the **onboarding wizard** if prompted (`openclaw onboard` or equivalent).
- In config, **disable sub-agents** so only the main OpenClaw agent is used (check OpenClaw docs or config for “sub-agent”, “subagent”, or “agents” and set to single main agent).
- Confirm the gateway: `openclaw gateway start` and `openclaw gateway status` (or `clawdbot gateway start` / `clawdbot gateway status` depending on your build).

Then restore the wallet from the backup (see above).

### 2.1 Disable sub-agents (single main agent only)

If OpenClaw is still set up to require sub-agents or “workers” (e.g. a “defi worker” for vault checks), the main agent will not use Factor MCP directly. Prefer **one main agent** that has Factor MCP and the factor-strategies skill, with sub-agents/delegations disabled.

**On the Pi (or machine where OpenClaw runs):**

1. **Locate config** (as the user that runs OpenClaw, often `openclaw` or `pi`):
   - `~/.clawdbot/clawdbot.json` or `~/.openclaw/openclaw.json`
   - Or under `/opt/openclaw/` if installed system-wide (e.g. `config/clawdbot.json`).

2. **Look for** keys such as: `delegations`, `subAgents`, `sub_agents`, `workers`, `agents` (array). Set so that only the main agent is used (e.g. empty list, or “single agent” / “no sub-agent” option in UI).

3. **Restart the gateway** after changes:  
   `openclaw gateway restart` or `clawdbot gateway restart` (or restart the OpenClaw service).

4. **Verify**: In chat, ask OpenClaw to list your vaults with Factor MCP (e.g. “Use Factor MCP: run factor_get_owned_vaults”). It should call the tool directly instead of asking for a “defi worker.”

To **find** where OpenClaw stores config on the Pi, run (from repo):  
`ssh piclaw 'bash -s' < scripts/openclaw-factor/find-openclaw-config.sh`  
or copy and run `scripts/openclaw-factor/find-openclaw-config.sh` on the Pi.

**Pi-specific (Andrea0x.eth_Claw with Supervisor/workers):** The running app is in `/opt/openclaw/src/index.js`. The Supervisor has no Factor tools and delegates to a **defi** worker. To let the main agent answer “our vault?” without delegating, run on the Pi: `sudo bash scripts/openclaw-factor/patch-supervisor-factor-readonly.sh` (adds read-only Factor to the Supervisor), then `sudo systemctl restart openclaw`. See `docs/PI-INVENTORY.md` for the full layout.

---

## 3. Full control: terminal and browser

OpenClaw must be allowed to use:

- **Terminal / shell:** Unrestricted shell access (run any command). In OpenClaw config, ensure the shell/s terminal tool is enabled and not restricted (e.g. no allowlist that blocks needed commands).
- **Browser:** Browser automation or control (e.g. open URLs, fill forms, click). If OpenClaw exposes a “browser” or “puppeteer” tool or skill, enable it and give it the necessary permissions.

Where to set this depends on your OpenClaw version:

- **Config file:** Often `~/.openclaw/openclaw.json` or `~/.clawdbot/clawdbot.json`. Look for `tools`, `skills`, or `permissions` and enable shell and browser.
- **Onboarding:** During `openclaw onboard`, choose options that grant “full control” or “terminal + browser” if available.
- **Skills:** Some setups use a “system” or “control” skill that enables terminal and browser; ensure it is enabled.

If you use the PiClaw-style config (YAML under `config/openclaw/openclaw.yaml`), keep:

- `tools.shell.allowed_commands: "*"` and `tools.shell.max_timeout` high enough.
- Any browser or automation tool enabled.

Result: OpenClaw can run any terminal command and drive the browser as needed.

---

## 4. Install Factor MCP

Factor MCP provides the `factor_*` tools (vault, strategy, wallet, etc.). Install it on the same machine (or a reachable one) and register it as an MCP server in OpenClaw.

**Install Factor MCP (Node 18+):**

```bash
curl -sSL https://raw.githubusercontent.com/FactorDAO/factor-mcp/main/install.sh | bash
```

Or manually:

```bash
git clone https://github.com/FactorDAO/factor-mcp.git
cd factor-mcp
npm install
npm run build
```

Then configure OpenClaw to use the Factor MCP server. Add an MCP server entry pointing to Factor MCP:

- **If OpenClaw uses a global MCP config** (e.g. `~/.openclaw/openclaw.json` or `~/.clawdbot/clawdbot.json`), add a server block like:

```json
"mcpServers": {
  "factor": {
    "command": "node",
    "args": ["/path/to/factor-mcp/dist/index.js"],
    "env": {
      "ALCHEMY_API_KEY": "your_alchemy_key",
      "DEFAULT_CHAIN": "ARBITRUM_ONE"
    }
  }
}
```

- **If OpenClaw uses Cursor-style MCP config**, add the same `factor` server to the MCP servers list used by OpenClaw.

Replace `/path/to/factor-mcp` with the real path (e.g. `~/factor-mcp` or `/opt/factor-mcp`). Set `ALCHEMY_API_KEY` (or your RPC) and `DEFAULT_CHAIN` as needed. Restart the OpenClaw gateway after changing MCP config.

Or use the script (from repo root):

```bash
bash scripts/openclaw-factor/install-factor-mcp.sh
```
It prints the MCP config snippet to add to OpenClaw.

It installs Factor MCP and prints the exact config snippet to add to OpenClaw.

---

## 5. Install the factor-strategies skill

The **factor-strategies** skill (this repo) gives OpenClaw the full context: wallet → config → upgradable vaults → strategies → management. OpenClaw loads skills from:

1. `<workspace>/skills` (highest priority)
2. `~/.clawdbot/skills/` (user overrides)
3. Bundled skills

Copy the skill into one of these so it appears as a single skill named `factor-strategies`:

**Option A – User directory (recommended):**

```bash
SKILLS_DIR=~/.clawdbot/skills
mkdir -p "$SKILLS_DIR"
cp -r .cursor/skills/factor-strategies "$SKILLS_DIR/"
```

**Option B – Workspace:**

```bash
mkdir -p skills
cp -r .cursor/skills/factor-strategies skills/
```

Then in OpenClaw config (e.g. `clawdbot.json` or `openclaw.json`), ensure the skills directory is set and the skill is enabled:

```json
"skills": {
  "dir": "/path/to/skills",
  "entries": {
    "factor-strategies": { "enabled": true }
  }
}
```

If the default is already `~/.clawdbot/skills/`, no need to set `dir`; just ensure the folder `factor-strategies` is there and enabled. Restart the gateway so the skill loads:

```bash
openclaw gateway restart
# or
clawdbot gateway restart
```

Or use the script (from repo root; set `OPENCLAW_SKILLS_DIR` if you use a custom path):

```bash
bash scripts/openclaw-factor/install-factor-skill.sh
# default target: ~/.clawdbot/skills
```

---

## 6. Checklist

| Step | Action |
|------|--------|
| 1 | Back up `~/.foundry/keystores` and `~/.factor-mcp` (and config) with `backup-wallet.sh`. |
| 2 | Install new OpenClaw: `curl -fsSL https://openclaw.ai/install.sh | bash -s -- --beta`. |
| 3 | Complete onboarding; disable sub-agent (single main agent only). |
| 4 | Restore wallet (and Factor config) from backup. |
| 5 | Enable full control: terminal (unrestricted shell) + browser in OpenClaw config. |
| 6 | Install Factor MCP and add it to OpenClaw MCP config; restart gateway. |
| 7 | Install factor-strategies skill into `~/.clawdbot/skills/` (or workspace/skills); enable and restart gateway. |
| 8 | Verify: `openclaw gateway status`, then in chat ask OpenClaw to run `factor_get_config` or list Factor tools. |

After this, OpenClaw has a clean memory (new install), the same wallet (restored), full control of the PC (terminal + browser), Factor MCP (all `factor_*` tools), and the factor-strategies skill for creating and managing upgradable vaults and self-sustainable strategies.
