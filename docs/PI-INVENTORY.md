# Pi (piclaw) inventory and layout

Summary of what runs on the Raspberry Pi **piclaw** (hostname), used for OpenClaw + Factor and PiClaw services.

---

## System

| Item | Value |
|------|--------|
| OS | Debian GNU/Linux 13 (trixie), aarch64 |
| Kernel | 6.12.62+rpt-rpi-v8 |
| Root disk | `/dev/sda2` ~196G (9% used) |
| Data | `/dev/sda3` mounted at `/data` ~719G (~1% used) |
| RAM | ~3.8G |
| Swap | 2G |

---

## Users and homes

| User | Home | Role |
|------|------|------|
| **openclaw** | `/home/openclaw` | Runs OpenClaw DeFi agent, Factor MCP, wallet |
| **pi** | `/home/pi` | SSH admin; Raspberry_claw repo, backups |

---

## Key paths

| Path | Description |
|------|-------------|
| `/opt/openclaw` | Andrea0x.eth_Claw app: main `src/index.js`, dashboard, Discord/Telegram, Factor MCP bridge |
| `/opt/openclaw/config` | `openclaw.yaml`, `tools.yaml` (PiClaw-style config; main app uses its own code config) |
| `/opt/openclaw/src` | Entry: `index.js` (DeFi agent + Supervisor/workers), `dashboard.mjs` |
| `/opt/openclaw/factor-mcp` | Factor MCP server (used by OpenClaw) |
| `/opt/factor-mcp` | Standalone Factor MCP install (`dist/`, node_modules) |
| `/home/openclaw/.factor-mcp` | Factor MCP config and wallet (e.g. `config.json`, `wallets/Andrea0x.json`) |
| `/home/openclaw/.foundry` | Foundry keystores (if used) |
| `/home/pi/.clawdbot/skills` | factor-strategies skill (synced from repo) |
| `/data` | Data, logs, backups, RAG, Ollama models (see config) |

---

## Running services (systemd)

| Service | Description |
|---------|-------------|
| **openclaw.service** | Andrea0x.eth_Claw - OpenClaw DeFi Agent (main app on port 3100) |
| piclaw-dashboard.service | PiClaw Dashboard |
| piclaw-discord.service | Discord bot |
| piclaw-telegram.service | Telegram bot |
| piclaw-tunnel.service / cloudflared-tunnel.service | Cloudflare tunnel(s) |
| nordvpnd.service | NordVPN (e.g. Meshnet) |
| docker.service, containerd.service | Containers |
| ssh.service | SSH (port 2222) |

---

## OpenClaw DeFi agent (Andrea0x.eth_Claw)

- **Binary/config**: `/opt/openclaw/src/index.js` (and config in code / env).
- **AI**: MiniMax (OAuth + API); Factor via MCP.
- **Factor MCP**: Spawned from `FACTOR_MCP_PATH` (default `/opt/openclaw/factor-mcp/dist/index.js`); wallet/config under `/home/openclaw/.factor-mcp`.
- **Architecture**: **Supervisor + workers**. The Supervisor has limited tools (`agent_status`, `agent_journal`). It delegates to workers via `[DELEGATE:name:task]`:
  - **defi**: Factor Protocol (all `factor_*` tools + eth_balance, shell).
  - **research**: web_search, web_fetch, shell.
  - **system**: shell, read_file, write_file, system_info.
  - **coder**: shell, read_file, write_file, web_search, web_fetch.
- **Issue**: The Supervisor does **not** have Factor tools. So when the user asks “what’s our vault?”, the Supervisor cannot call `factor_get_owned_vaults`; it can only delegate to the defi worker. If it answers without delegating, it says it needs the “defi worker”.
- **Fix (intended)**: Give the Supervisor read-only Factor access (e.g. `factor`, `eth_balance`) and update its prompt so it uses Factor for “our vault” / vault list / shares / config, and delegates only for execution (deposit, withdraw, execute_manager). See `scripts/openclaw-factor/patch-supervisor-factor-readonly.sh` and doc below.

---

## Config files (YAML on Pi)

- **`/opt/openclaw/config/openclaw.yaml`**: PiClaw agent name, server port (3100), Ollama (piclaw-agent), tools (shell, read_file, write_file, gpio, system_info, service, network, process), monitoring, security, storage under `/data`.
- **`/opt/openclaw/config/tools.yaml`**: Tool definitions (shell, read_file, write_file, gpio, system_info, service, network, process, gpio_python, docker).

The **DeFi agent** logic (Supervisor, workers, Factor MCP, MiniMax) is in **code** (`/opt/openclaw/src/index.js`), not in these YAMLs.

---

## SSH

- **Port**: 2222 (not 22).
- **From Mac**: Use `ssh piclaw` after running `scripts/00-mac-setup/03-setup-ssh-config.sh --ip 192.168.1.88 --port 2222` (or your Pi IP).

---

## Disabling sub-agents / giving Supervisor direct Factor read

This stack does not use a separate “OpenClaw config file” for delegations; the **Supervisor vs workers** setup is hard-coded in `/opt/openclaw/src/index.js`.

To let the main agent answer “our vault” without delegating:

1. **Add Factor (read-only) to the Supervisor**: In `index.js`, add `factor` and `eth_balance` to `SUPERVISOR_TOOLS`, and update `SUPERVISOR_PROMPT` so the Supervisor may use Factor for read-only checks (vault list, vault info, shares, config) and must delegate to defi for execution.
2. **Restart**: `sudo systemctl restart openclaw`

A patch script is provided: `scripts/openclaw-factor/patch-supervisor-factor-readonly.sh` (run on the Pi, or via `ssh piclaw 'bash -s' < scripts/openclaw-factor/patch-supervisor-factor-readonly.sh` after syncing the repo).

---

## References

- OpenClaw + Factor setup: `docs/OPENCLAW-FACTOR-SETUP.md`
- Factor skill: `.cursor/skills/factor-strategies/` (synced to `~/.clawdbot/skills/factor-strategies` on Pi for openclaw user if applicable)
- Deploy from Mac: `scripts/openclaw-factor/from-mac-deploy-to-pi.sh`
