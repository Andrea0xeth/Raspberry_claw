# Piano: Claude Code CLI su Raspberry Pi — Agent Headless stile OpenClaw

**Obiettivo:** Far girare Claude Code CLI su Raspberry Pi come agent autonomo, accessibile solo via SSH, con cron jobs, memoria persistente e scheduling simile a OpenClaw.

---

## 1. Ricerca e vincoli reali

### 1.1 Claude Code CLI su ARM64

| Aspetto | Stato |
|---------|-------|
| **Supporto ARM64** | Sì, binario nativo (`curl https://claude.ai/install.sh \| bash` rileva aarch64) |
| **Bug noti** | Installer può rifiutare aarch64 come "Unsupported architecture: arm" (Issue #3569). **Workaround:** `npm install -g @anthropic-ai/claude-code@0.2.114` |
| **Requisiti** | Node.js 18+ (consigliato 22), Ubuntu/Debian 64-bit, 4GB RAM consigliato, swap 2GB se RAM ≤2GB |
| **AVX/Illegal instruction** | Problema su x86 senza AVX. Su Raspberry (ARM) **non applicabile** |

### 1.2 Headless (no GUI)

- **`-p` / `--print`:** prompt passato come argomento, esecuzione non interattiva.
- **`--output-format json`:** output strutturato per parsing e automazione.
- **`--resume`:** riprende sessioni precedenti per contesto multi-turn.
- **`--allowedTools`:** restrizione tools in ambienti automatizzati.
- **`--permission-mode plan`:** modalità read-only per analisi.

### 1.3 OpenClaw — riferimento architetturale

- **Cron:** `openclaw cron add "nome" --schedule "30 7 * * *"` → jobs in `~/.openclaw/cron/jobs.json`.
- **Memoria:** `MEMORY.md` (preferenze permanenti) + `memory/YYYY-MM-DD.md` (log giornalieri).
- **Heartbeat:** checklist periodica, risposta `HEARTBEAT_OK` se nulla da fare.
- **Delivery:** Telegram, Discord, webhook.

---

## 2. Architettura proposta

```
┌─────────────────────────────────────────────────────────────────┐
│                     RASPBERRY PI (SSH only)                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌──────────────────────────────────┐   │
│  │   system cron    │───▶│  claude-agent-runner.sh           │   │
│  │  /etc/cron.d/    │    │  (wrapper che chiama claude -p)   │   │
│  └──────────────────┘    └──────────────────┬───────────────┘   │
│                                             │                    │
│                                             ▼                    │
│  ┌──────────────────┐    ┌──────────────────────────────────┐   │
│  │  Claude Code CLI │◀──▶│  ~/.claude-code-agent/            │   │
│  │  claude -p "..." │    │  MEMORY.md, memory/YYYY-MM-DD.md   │   │
│  └──────────────────┘    │  sessions/, logs/                  │   │
│            │             └──────────────────────────────────┘   │
│            │                                                    │
│            ▼                                                    │
│  ┌──────────────────┐    ┌──────────────────────────────────┐   │
│  │  Anthropic API   │    │  Telegram / Discord (opzionale)  │   │
│  │  (cloud)         │    │  delivery risultati              │   │
│  └──────────────────┘    └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Flusso:**
1. Cron lancia `claude-agent-runner.sh` a orari fissi.
2. Lo script carica contesto da `MEMORY.md` e `memory/YYYY-MM-DD.md`.
3. Costruisce prompt con checklist (stile HEARTBEAT).
4. Esegue `claude -p "..." --output-format json`.
5. Salva output in `memory/YYYY-MM-DD.md` e opzionalmente invia a Telegram/Discord.

---

## 3. Piano step-by-step

### Fase 0: Prerequisiti hardware e OS

| Requisito | Dettaglio |
|-----------|-----------|
| **Raspberry Pi** | Pi 4 (4GB) o Pi 5 — 2GB minimo, 4GB consigliato |
| **OS** | Raspberry Pi OS **Lite 64-bit** (non kernel 64 + userspace 32) |
| **Storage** | SSD USB preferibile a microSD |
| **Swap** | 2GB se RAM ≤2GB: `CONF_SWAPSIZE=2048` in `/etc/dphys-swapfile` |
| **SSH** | Abilitato, accesso solo via SSH (nessuna GUI) |

### Fase 1: Installazione Claude Code CLI

```bash
# 1. Node.js 22 (ARM64)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Installazione Claude Code
# Metodo A (preferito): script ufficiale
curl -fsSL https://claude.ai/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"

# Metodo B (fallback se "Unsupported architecture"):
npm install -g @anthropic-ai/claude-code@0.2.114

# 3. Autenticazione (una tantum, via SSH)
claude
# Seguire wizard login — richiede interattività iniziale
# Dopo: token in ~/.config/claude/ o simile
```

**Verifica:**
```bash
claude --version
claude -p "Reply with: OK" --output-format json
```

### Fase 2: Directory e struttura memoria (stile OpenClaw)

```
~/.claude-code-agent/
├── MEMORY.md              # Preferenze permanenti, regole (<3k token)
├── memory/
│   └── 2025-03-04.md      # Log giornaliero append-only
├── sessions/              # Session IDs per --resume
├── logs/                  # Output cron, errori
├── config.env             # ENV vars (ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, ecc.)
└── HEARTBEAT.md           # Checklist periodica (come OpenClaw)
```

**HEARTBEAT.md** — template esempio:

```markdown
# Heartbeat checklist — rispondi HEARTBEAT_OK se tutto ok

1. Controlla carico sistema: `uptime`, `free -h`
2. Controlla spazio disco: `df -h /`
3. Se nulla richiede azione, rispondi esattamente: HEARTBEAT_OK
4. Altrimenti descrivi problema e azione suggerita
```

**MEMORY.md** — contesto persistente:

```markdown
# Memoria agente Claude su Raspberry Pi

- Sono un agent che gira su Raspberry Pi 4, accessibile via SSH.
- Uso read_memory e append_memory per contesto tra esecuzioni.
- Cron mi lancia ogni 15/30 min. Se non c'è nulla da fare: HEARTBEAT_OK.
- Non ho GUI: tutto via terminale/SSH.
```

### Fase 3: Wrapper script `claude-agent-runner.sh`

```bash
#!/bin/bash
# claude-agent-runner.sh — invoca Claude Code in headless con contesto memoria

AGENT_ROOT="$HOME/.claude-code-agent"
MEMORY_FILE="$AGENT_ROOT/memory/$(date +%Y-%m-%d).md"
HEARTBEAT="$AGENT_ROOT/HEARTBEAT.md"
LOG="$AGENT_ROOT/logs/$(date +%Y%m%d).log"

mkdir -p "$(dirname "$MEMORY_FILE")" "$AGENT_ROOT/logs"

# Carica contesto
CONTEXT=""
[[ -f "$AGENT_ROOT/MEMORY.md" ]] && CONTEXT+="$(cat "$AGENT_ROOT/MEMORY.md")\n\n"
[[ -f "$MEMORY_FILE" ]] && CONTEXT+="--- Oggi ---\n$(tail -c 4000 "$MEMORY_FILE")\n\n"
[[ -f "$HEARTBEAT" ]] && CONTEXT+="--- Checklist ---\n$(cat "$HEARTBEAT")"

PROMPT="${CONTEXT}

Esegui la checklist. Se tutto ok rispondi esattamente HEARTBEAT_OK. 
Output in JSON via --output-format json."

# Esegui (timeout 5 min)
timeout 300 claude -p "$PROMPT" --output-format json 2>>"$LOG" | tee -a "$LOG"
```

Lo script va reso eseguibile e testato manualmente prima del cron.

### Fase 4: Cron jobs (sistema)

File `/etc/cron.d/claude-agent`:

```cron
# Claude Code Agent — heartbeat ogni 30 min (come OpenClaw)
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

# Heartbeat ogni 30 min
*/30 * * * * openclaw /home/openclaw/.claude-code-agent/claude-agent-runner.sh >> /home/openclaw/.claude-code-agent/logs/cron.log 2>&1

# Opzionale: report mattutino alle 7:30
# 30 7 * * * openclaw /home/openclaw/.claude-code-agent/claude-morning-brief.sh >> ...
```

**Nota:** Usare utente `openclaw` (o equivalente) per coerenza con Raspberry Claw.

### Fase 5: Integrazione con OpenClaw esistente (opzionale)

Se Raspberry Claw è già in esecuzione:

- **Opzione A:** Claude Code come “agente esterno” — cron separato, memoria separata. Nessuna modifica a OpenClaw.
- **Opzione B:** OpenClaw può **chiamare** Claude Code via `shell` tool:

  ```javascript
  // In openclaw: tool che invoca claude -p
  tools.invoke_claude = async ({ prompt }) => {
    const { stdout } = await execAsync(`claude -p "${prompt.replace(/"/g, '\\"')}" --output-format json`, { timeout: 120000 });
    return JSON.parse(stdout);
  };
  ```

- **Opzione C:** Claude Code per task “pesanti” (analisi codice, refactor) mentre OpenClaw gestisce heartbeat/cron/DeFi.

### Fase 6: Delivery risultati (Telegram/Discord)

Aggiungere al wrapper uno step finale:

```bash
# Dopo claude -p, se TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID sono settati:
RESULT=$(timeout 300 claude -p "$PROMPT" --output-format json 2>>"$LOG")
echo "$RESULT" >> "$MEMORY_FILE"

# Invia a Telegram (primi 4000 char)
if [[ -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_CHAT_ID" ]]; then
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=$(echo "$RESULT" | head -c 4000)"
fi
```

---

## 4. Rischi e mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| Installer rifiuta aarch64 | Usare `npm install -g @anthropic-ai/claude-code@0.2.114` |
| RAM insufficiente | Swap 2GB, limitare prompt/context, ridurre frequenza cron |
| Timeout API | `timeout 300` sullo script, retry con backoff in cron |
| Costi API Anthropic | Cron non troppo frequenti (es. 30 min), prompt brevi, monitor token usage |
| Token scaduto | `claude` richiede re-auth interattiva — pianificare accesso SSH per refresh |

---

## 5. Checklist finale

- [ ] Raspberry Pi OS 64-bit Lite, SSH attivo
- [ ] Node.js 22, swap 2GB se RAM ≤2GB
- [ ] Claude Code CLI installato e autenticato
- [ ] Directory `~/.claude-code-agent/` con MEMORY.md, HEARTBEAT.md, memory/
- [ ] Script `claude-agent-runner.sh` testato a mano
- [ ] Cron configurato in `/etc/cron.d/claude-agent`
- [ ] (Opzionale) Integrazione Telegram/Discord
- [ ] (Opzionale) Collegamento a OpenClaw via tool `invoke_claude`

---

## 6. Riferimenti

- [Claude Code Headless](https://docs.anthropic.com/en/docs/claude-code/headless)
- [OpenClaw Cron Jobs](https://docs.openclaw.ai/cron-jobs)
- [OpenClaw Memory](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw su Raspberry Pi](https://openclawlab.com/en/docs/platforms/raspberry-pi/)
- [Claude Code ARM64 bug #3569](https://github.com/anthropics/claude-code/issues/3569)
- [Raspberry Pi con Claude Code](https://www.danielcorin.com/til/raspberry-pi/reviving-a-raspberry-pi-with-claude-code)
