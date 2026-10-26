# Agent handoff — Raspberry Claw (`piclaw`)

Documento unico per un **agente esterno** (o umano) che deve lavorare sul Raspberry Pi del progetto. Contiene canali di accesso, layout, API, secrets (dove stanno, non i valori), deploy e indice della documentazione.

**Repo:** `github.com/Andrea0xeth/Raspberry_claw`  
**Hostname tipico:** `piclaw`  
**Hardware:** Raspberry Pi 4 Model B, ~4 GB RAM, SSD ~1 TB (root + `/data`)  
**Inventario live:** [`PI-INVENTORY.md`](PI-INVENTORY.md) · Hardware: [`HARDWARE-GUIDE.md`](HARDWARE-GUIDE.md)

---

## 0. Priorità: come raggiungere il Pi

| Priorità | Canale | Quando usarlo | Come |
|----------|--------|---------------|------|
| 1 | **SSH LAN** | Stessa rete di casa | `ssh piclaw` oppure `ssh -p 2222 pi@<IP>` / `ssh pi@piclaw.local` |
| 2 | **SSH NordVPN Meshnet** | Reti diverse (consigliato) | `ssh pi@piclaw.nord` (Meshnet ON su Mac e Pi) |
| 3 | **SSH Port Forward + DynDNS** | Senza Meshnet | `ssh -p 2222 pi@<IP-pubblico>` o `pi@piclaw.duckdns.org` |
| 4 | **SSH tunnel → API** | UI/API dal Mac senza esporre porte | `ssh -L 3100:localhost:3100 -L 11434:localhost:11434 piclaw` |
| 5 | **Cloudflare Tunnel (HTTP)** | Dashboard / webhook pubblici | `https://piclaw.supasoft.xyz` → porta **3100** sul Pi |
| 6 | **Telegram bot** | Chat con l’agente | Bridge `piclaw-telegram` → `POST http://127.0.0.1:3100/chat` |
| 7 | **Discord webhooks** | Log, report cron, messaggi agente | Solo outbound (webhook URL in env) |
| 8 | **Instagram DM** | Opzionale | Webhook `https://…/webhook/instagram` su OpenClaw |
| 9 | **HTTP locale sul Pi** | Da shell sul Pi o tunnel | `http://127.0.0.1:3100` |

**Utenti SSH:** `pi` (admin), `openclaw` (processo agente).  
**Porta SSH tipica in produzione:** `2222` (22 spesso ancora per LAN). Solo chiave pubblica; no root SSH.

Dettaglio remoto: [`ACCESSO-REMOTO.md`](ACCESSO-REMOTO.md) · Comandi: [`PI-COMANDI.md`](PI-COMANDI.md)

---

## 1. Metodi di accesso e comunicazione (dettaglio)

### 1.1 SSH — rete locale

```bash
# Discovery / prima volta
bash scripts/00-mac-setup/02-connect-ssh.sh
ssh pi@piclaw.local
ssh pi@192.168.1.XXX

# Config permanente sul Mac
bash scripts/00-mac-setup/03-setup-ssh-config.sh --ip 192.168.1.88 --port 2222
ssh piclaw
ssh piclaw 'uptime'
```

Hardening sul Pi: `scripts/01-os-setup/00-configure-ssh.sh`.

### 1.2 SSH — NordVPN Meshnet (fuori casa)

```bash
# Sul Pi (una volta)
sudo bash scripts/07-remote-access/01-install-nordvpn-meshnet.sh

# Sul Mac: Meshnet ON in app NordVPN
ssh pi@piclaw.nord
# oppure IP Meshnet da: nordvpn meshnet peer list
```

Non serve la VPN “classica” verso un server Nord; serve solo Meshnet peer-to-peer.

### 1.3 SSH — Port forwarding + DuckDNS

```bash
sudo bash scripts/07-remote-access/02-setup-port-forwarding.sh
# Router: WAN :2222 → Pi :2222 TCP
ssh -p 2222 pi@piclaw.duckdns.org   # o IP pubblico
```

Se c’è CGNAT, questo metodo **non** funziona → usare Meshnet o Cloudflare Tunnel.

### 1.4 Tunnel SSH per API / Ollama dal Mac

```bash
ssh -L 3100:localhost:3100 -L 11434:localhost:11434 piclaw
# Browser/Mac: http://localhost:3100/health  ·  Ollama :11434
```

### 1.5 Cloudflare Tunnel (HTTP pubblico)

Servizi tipici: `piclaw-tunnel.service` / `cloudflared-tunnel.service`.  
Esempio URL documentato: **`https://piclaw.supasoft.xyz`** → OpenClaw **3100**.

| Path pubblico | Uso |
|---------------|-----|
| `/dashboard` | Dashboard agente (Agents, Chat, Logs, Files) |
| `/` | Redirect a dashboard (HTML) |
| `/health` | Health check |
| `/chat` | Chat API (usata dal bridge Telegram) |
| `/webhook/instagram` | Webhook Meta Instagram |

Dashboard: [`DASHBOARD-PI-VIEW.md`](DASHBOARD-PI-VIEW.md)

### 1.6 Telegram

- Servizio: `piclaw-telegram.service`
- Env: `/opt/openclaw/config/telegram.env` → `TELEGRAM_BOT_TOKEN`, opzionale `TELEGRAM_CHAT_ID`
- Flusso: messaggio Telegram → bridge → `POST /chat` → risposta in chat
- Cron BTC può anche mandare su Telegram se `TELEGRAM_CHAT_ID` è impostato

### 1.7 Discord

Solo **webhook outbound** (nessun bot inbound obbligatorio):

- `DISCORD_WEBHOOK_URL` / `DISCORD_THREAD_ID` — messaggi agente
- `DISCORD_LOG_WEBHOOK` / `DISCORD_LOG_THREAD_ID` — log + report sistema / BTC

Vedi [`ENV-VARS.md`](ENV-VARS.md).

### 1.8 Instagram (opzionale)

Token su Pi: `/opt/openclaw/.instagram_verify_token`, `.instagram_access_token`.  
Callback Meta: `https://<tunnel>/webhook/instagram`. Setup in [`PI-COMANDI.md`](PI-COMANDI.md).

### 1.9 API HTTP OpenClaw (localhost / tunnel)

| Endpoint | Metodo | Note |
|----------|--------|------|
| `/health` | GET | Alive |
| `/chat` | POST | Chat agente |
| `/dashboard` | GET | UI |
| `/factor` | POST | Tool Factor MCP proxy |
| `/factor/tools` | GET | Lista tool Factor |
| `/pi/system` | GET | System report (cron) |
| `/pi/files`, `/pi/file` | GET | Browser FS (dashboard) |
| `/agent/messages` | GET | Journal tab Agents |
| `/logs` | GET | Journal + agent.log + syslog |
| `/heartbeat` | GET/POST | Heartbeat |
| `/cron/orchestrate`, `/cron/yield-optimize` | POST | Richiedono `CRON_SECRET` |

Porta default: **`OPENCLAW_PORT=3100`**. Multi-agent opzionale: 3101–3103 ([`OPENCLAW-4-AGENTS.md`](OPENCLAW-4-AGENTS.md)).

---

## 2. Layout sul Pi (cosa toccare)

| Path | Ruolo |
|------|--------|
| `/opt/openclaw/` | App runtime (src, skills, public, factor-mcp) |
| `/opt/openclaw/src/index.js` | Entry DeFi agent + Supervisor/workers |
| `/opt/openclaw/config/` | YAML + `telegram.env` |
| `/home/openclaw/.factor-mcp/` | Config Factor + wallet (**non committare**) |
| `/home/pi/Raspberry_claw/` | Clone repo (sync da Mac) |
| `/data/` | Log, journal, modelli Ollama, backup |
| `/data/logs/openclaw/` | `agent.log`, `error.log` |
| `/data/agent-journal/` | Journal chat/tool per dashboard |

**Servizi systemd rilevanti:** `openclaw`, `piclaw-telegram`, `piclaw-discord` (se presente), tunnel Cloudflare, `nordvpnd`, `docker`, `ssh`.

---

## 3. Come ragiona l’agente sul Pi

Architettura tipica **Supervisor + workers** in `/opt/openclaw/src/index.js`:

| Ruolo | Tool tipici |
|-------|-------------|
| Supervisor | `agent_status`, `agent_journal`; delega `[DELEGATE:name:task]` |
| defi | Factor MCP (`factor_*`), `eth_balance`, shell |
| research | `web_search`, `web_fetch`, shell |
| system | shell, read/write file, `system_info` |
| coder | shell, file, web |

Tools YAML di riferimento: `config/openclaw/tools.yaml` (shell, gpio, system_info, service, network, process, docker, …).  
Skill Pi: `openclaw/skills/pi-commands.md`.

**Importante:** il Supervisor di default **non** ha tool Factor in scrittura; per “lista vault” senza delega usare patch read-only: `scripts/openclaw-factor/patch-supervisor-factor-readonly.sh` (vedi inventario).

---

## 4. Secrets e config (dove sono — mai in git)

| Secret / config | Dove sul Pi |
|-----------------|-------------|
| Telegram | `/opt/openclaw/config/telegram.env` |
| OpenRouter / Kimi / MiniMax | env o file `.openrouter_key` / `.kimi_key` / `.minimax_key` sotto root OpenClaw |
| Discord webhooks | env systemd / EnvironmentFile |
| Instagram | `/opt/openclaw/.instagram_*` |
| Factor wallet | `/home/openclaw/.factor-mcp/wallets/` |
| Factor config | `/home/openclaw/.factor-mcp/config.json` (`simulationMode`, `defaultChain`) |
| `CRON_SECRET` | env OpenClaw |

Catalogo variabili: [`ENV-VARS.md`](ENV-VARS.md). **Non** chiedere/incollare private key in chat; operare solo via Factor MCP / file sul Pi con permessi corretti.

---

## 5. Deploy e operazioni tipiche

### Deploy codice da Mac → Pi

```bash
# Sync
rsync -az -e "ssh -p 2222" openclaw/ pi@piclaw:Raspberry_claw/openclaw/

# Install + restart (esempio)
ssh -p 2222 pi@piclaw "sudo cp Raspberry_claw/openclaw/src/index.js \
  Raspberry_claw/openclaw/src/dashboard-routes.js \
  Raspberry_claw/openclaw/src/telegram-bridge.js /opt/openclaw/src/ && \
  sudo cp -r Raspberry_claw/openclaw/skills/* /opt/openclaw/skills/ && \
  sudo cp -r Raspberry_claw/openclaw/public/* /opt/openclaw/public/ && \
  sudo chown -R openclaw:openclaw /opt/openclaw/src /opt/openclaw/skills /opt/openclaw/public && \
  sudo systemctl restart openclaw"
```

Script: `scripts/openclaw-factor/from-mac-deploy-to-pi.sh`.

### Comandi di routine sul Pi

```bash
sudo systemctl status openclaw
sudo systemctl restart openclaw
journalctl -u openclaw -n 100 --no-pager
curl -s http://127.0.0.1:3100/health
vcgencmd measure_temp
free -h; df -h / /data
```

Sudo limitato per user `openclaw` (solo start/stop/restart openclaw): `scripts/openclaw-factor/install-openclaw-sudo.sh`.

---

## 6. Checklist per un agente che deve lavorare sul Pi

1. **Connettività:** prova `ssh piclaw` (LAN) o `ssh pi@piclaw.nord` (remoto). Se fallisce, verifica Meshnet / IP / porta 2222.
2. **Salute:** `curl -s http://127.0.0.1:3100/health` (sul Pi o via tunnel SSH).
3. **Servizi:** `systemctl is-active openclaw piclaw-telegram` (+ tunnel se serve HTTP pubblico).
4. **Layout:** conferma path in [`PI-INVENTORY.md`](PI-INVENTORY.md); non inventare path.
5. **Modifiche codice:** edit nel repo → sync → copia in `/opt/openclaw` → `systemctl restart openclaw`.
6. **Factor / wallet:** backup prima di reset (`scripts/openclaw-factor/backup-wallet.sh`); non commitare wallet.
7. **Secrets:** leggi da file sul Pi; non stampare secret in Discord/Telegram/log pubblici.
8. **GPIO / hardware:** pinout e limiti in [`HARDWARE-GUIDE.md`](HARDWARE-GUIDE.md); tool `gpio` / `gpio_python`.
9. **AI locale:** su 4GB preferire modelli piccoli (`llama3.2:1b`); altrimenti provider cloud (MiniMax/OpenRouter/Kimi) — [`AI-TUNING.md`](AI-TUNING.md), [`PI-OPENROUTER-SETUP.md`](PI-OPENROUTER-SETUP.md).
10. **Problemi:** [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

---

## 7. Indice documentazione (leggere in quest’ordine)

### Essenziale per operare

| Doc | Contenuto |
|-----|-----------|
| **Questo file** | Handoff completo accesso + workflow |
| [`PI-INVENTORY.md`](PI-INVENTORY.md) | Cosa gira sul Pi (OS, path, servizi, workers) |
| [`PI-COMANDI.md`](PI-COMANDI.md) | SSH, systemctl, Telegram, Instagram, API, deploy |
| [`ACCESSO-REMOTO.md`](ACCESSO-REMOTO.md) | Meshnet vs port forward |
| [`ENV-VARS.md`](ENV-VARS.md) | Variabili e secret |
| [`DASHBOARD-PI-VIEW.md`](DASHBOARD-PI-VIEW.md) | Dashboard e file browser |

### Setup e hardware

| Doc | Contenuto |
|-----|-----------|
| [`../README.it.md`](../README.it.md) | Setup completo IT (SD → SSD → stack) |
| [`../README.md`](../README.md) | Overview EN |
| [`SETUP-SPIEGATO.md`](SETUP-SPIEGATO.md) | SD vs SSD, USB-C = solo power |
| [`HARDWARE-GUIDE.md`](HARDWARE-GUIDE.md) | Specs Pi 4, GPIO, SSD, power |
| [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) | Diagnostica |

### Agente / DeFi / AI

| Doc | Contenuto |
|-----|-----------|
| [`OPENCLAW-FACTOR-SETUP.md`](OPENCLAW-FACTOR-SETUP.md) | Factor MCP, wallet, single agent |
| [`OPENCLAW-CRON.md`](OPENCLAW-CRON.md) | Heartbeat e cron |
| [`OPENCLAW-MULTI-AGENT.md`](OPENCLAW-MULTI-AGENT.md) | Multi-agente |
| [`OPENCLAW-4-AGENTS.md`](OPENCLAW-4-AGENTS.md) | Porte 3100–3103 e ruoli |
| [`AI-TUNING.md`](AI-TUNING.md) | Modelli Ollama su RPi4 |
| [`PI-OPENROUTER-SETUP.md`](PI-OPENROUTER-SETUP.md) | OpenRouter |
| [`KIMI-MOONSHOT-SETUP.md`](KIMI-MOONSHOT-SETUP.md) | Kimi |

### Skill runtime (sul Pi in `/opt/openclaw/skills/`)

- `pi-commands.md` — shell/OS/API dal punto di vista dell’agente on-device  
- Skill Factor (factor-strategies) — vault / yield / lifecycle  

### Script chiave

| Path | Uso |
|------|-----|
| `scripts/00-mac-setup/*` | SD, SSH discovery, `~/.ssh/config` |
| `scripts/01-os-setup/*` | OS + hardening SSH |
| `scripts/02-ssd-boot/*` | Migrazione SSD |
| `scripts/03-openclaw/*` | Install OpenClaw |
| `scripts/04-ai-engine/*` | Ollama + modelli |
| `scripts/07-remote-access/*` | Meshnet, port forward |
| `scripts/openclaw-factor/*` | Factor, deploy Mac→Pi, backup wallet, patch Supervisor |

---

## 8. Vincoli e sicurezza (per agenti)

- Non esporre private key, token bot, webhook o seed in commit, PR, Discord o chat pubbliche.
- Preferire `simulationMode: true` su Factor finché non si chiede esplicitamente esecuzione reale.
- Non aprire porte inutili; preferire Meshnet / tunnel SSH / Cloudflare rispetto a SSH 22 pubblico.
- GPIO: tensioni 3.3V logic; non pilotare carichi diretti senza driver/relay.
- Dopo cambi config Factor o env: sempre `sudo systemctl restart openclaw`.

---

## 9. Smoke test minimo (dopo qualsiasi intervento)

```bash
ssh piclaw 'curl -s http://127.0.0.1:3100/health && systemctl is-active openclaw && vcgencmd measure_temp && df -h / /data | tail -n +1'
```

Atteso: JSON health ok, `active`, temperatura, dischi montati.
