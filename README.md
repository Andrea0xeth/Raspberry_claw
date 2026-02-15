# Raspberry Claw

**Autonomous AI agent on Raspberry Pi** — tools, cron, Telegram, optional DeFi (Factor Protocol). One codebase, your hardware, your keys.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What is this?

Raspberry Claw turns a **Raspberry Pi 4** (or similar) into a **single-node AI agent** that:

- Runs an **OpenClaw-style agent** (HTTP API, tool loop, optional Ollama / OpenRouter / Kimi / MiniMax).
- Can talk on **Telegram** (and optionally **Instagram**) with a configurable persona.
- Sends **cron reports** (e.g. Bitcoin price, system stats) to **Discord** (and optionally Telegram).
- Optionally integrates **Factor Protocol** (DeFi vaults, strategies, MCP) for yield and vault management.
- Supports **multi-agent** setups (orchestrator, DeFi expert, executor, system improver) or a **single agent**.

All config and keys stay on your machine; no vendor lock-in.

---

## Features

| Area | What you get |
|------|----------------|
| **Agent** | Express server, tool-calling loop, skills (Markdown), memory, heartbeat |
| **AI** | Ollama (local), OpenRouter, Kimi (Moonshot), MiniMax — configurable per instance |
| **Channels** | Telegram bridge (long polling), Instagram webhook, Discord webhooks for logs/reports |
| **Cron** | In-process jobs: heartbeat, system report, Bitcoin price (Discord + optional Telegram) |
| **DeFi** | Factor MCP bridge, yield discovery, strategy build/simulate/execute (optional) |
| **Deploy** | Scripts for SSD boot, SSH, systemd, remote access (NordVPN Meshnet or port forwarding) |

---

## Quick start

### 1. Clone and prepare (on your machine)

```bash
git clone https://github.com/Andrea0xeth/Raspberry_claw.git
cd Raspberry_claw
```

### 2. Run the agent locally (no Pi)

```bash
cd openclaw
npm install
npm start
# Agent: http://127.0.0.1:3100 — health: /health, chat: POST /chat
```

### 3. On a Raspberry Pi (full stack)

- **Flash** Raspberry Pi OS (64-bit) Lite to SD, enable SSH, set hostname (e.g. `piclaw`).
- **Clone** this repo on the Pi (or sync from your Mac).
- **Run** the setup scripts in order (see [Project structure](#project-structure) and [docs](docs/)).

Example (from repo root on the Pi):

```bash
sudo bash scripts/01-os-setup/01-initial-setup.sh
sudo bash scripts/03-openclaw/01-install-openclaw.sh
# … then Ollama, Factor MCP, Telegram, etc. as needed
```

Detailed step-by-step (including SSD boot, SSH, and remote access) is in **[README.it.md](README.it.md)** (Italian) and in **docs/**.

---

## Requirements

- **Node.js** 18+ (for the agent and Telegram bridge).
- **Raspberry Pi**: Pi 4 (4GB RAM recommended) or similar; optional 1TB SSD for OS + models.
- **API keys** (as needed): OpenRouter, Kimi, MiniMax, Telegram Bot Token, Discord webhook(s). Stored locally only.

---

## Project structure

```
Raspberry_claw/
├── README.md                 # This file (English)
├── README.it.md              # Full setup guide (Italian)
├── LICENSE                   # MIT
├── CONTRIBUTING.md           # How to contribute
├── openclaw/                 # Agent and bridges
│   ├── src/
│   │   ├── index.js          # Main agent (Express, AI, tools, /chat, cron)
│   │   ├── telegram-bridge.js
│   │   ├── cron-jobs.js
│   │   └── dashboard-routes.js
│   ├── skills/               # Markdown skills (Factor, CLI, Pi, yield, …)
│   ├── heartbeat-templates/
│   └── package.json
├── config/
│   └── systemd/              # openclaw.service, piclaw-telegram.service
├── scripts/
│   ├── 00-mac-setup/         # SSH, SD prep (run on Mac)
│   ├── 01-os-setup/          # OS and SSH hardening (on Pi)
│   ├── 02-ssd-boot/          # SSD migration
│   ├── 03-openclaw/          # OpenClaw install
│   ├── 04-ai-engine/         # Ollama + models
│   ├── 05-optimization/      # SSD tuning
│   ├── 06-testing/
│   ├── 07-remote-access/     # NordVPN Meshnet, port forwarding
│   └── openclaw-factor/      # Factor MCP, deploy, backup
└── docs/                     # Guides (Factor, Kimi, cron, Telegram, …)
```

---

## Documentation

| Doc | Description |
|-----|-------------|
| [README.it.md](README.it.md) | Full setup (Italian): SSH, SSD, OpenClaw, Ollama, remote access |
| [docs/OPENCLAW-FACTOR-SETUP.md](docs/OPENCLAW-FACTOR-SETUP.md) | Factor MCP, wallet, single-agent |
| [docs/PI-COMANDI.md](docs/PI-COMANDI.md) | Pi commands (Italian): systemctl, Telegram, Instagram, deploy |
| [docs/OPENCLAW-CRON.md](docs/OPENCLAW-CRON.md) | Cron and heartbeat |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common issues and fixes |

---

## Contributing

We welcome contributions: bug reports, docs, fixes, new skills or tools, and ideas.

- **Issues**: [Open an issue](https://github.com/Andrea0xeth/Raspberry_claw/issues) for bugs or feature requests.
- **Pull requests**: See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow and conventions.
- **Code of conduct**: Be respectful and inclusive; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## License

[MIT](LICENSE). You can use, modify, and distribute this project under the terms of the MIT License.

---

## Credits

- [OpenClaw](https://openclaw.ai) — agent and gateway ideas.
- [Factor Protocol](https://factor.fi) — DeFi vaults and strategies (optional integration).
- Raspberry Claw contributors and the open-source community.
