# Claude Code Agent per Raspberry Pi

Script e template per far girare **Claude Code CLI** come agent headless su Raspberry Pi, con cron, memoria e heartbeat in stile OpenClaw.

## Prerequisiti

- Raspberry Pi 4 (4GB) o Pi 5
- Raspberry Pi OS **64-bit** Lite
- Node.js 22, Claude Code CLI installato e autenticato
- Vedi [docs/CLAUDE-CODE-CLI-PI-PLAN.md](../../docs/CLAUDE-CODE-CLI-PI-PLAN.md) per il piano completo

## Setup rapido

```bash
# 1. Crea directory agent
mkdir -p ~/.claude-code-agent/{memory,logs}
cp scripts/claude-code-agent/claude-agent-runner.sh ~/.claude-code-agent/
cp scripts/claude-code-agent/HEARTBEAT-template.md ~/.claude-code-agent/HEARTBEAT.md
cp scripts/claude-code-agent/MEMORY-template.md ~/.claude-code-agent/MEMORY.md
chmod +x ~/.claude-code-agent/claude-agent-runner.sh

# 2. (Opzionale) Telegram
echo 'TELEGRAM_BOT_TOKEN=xxx' >> ~/.claude-code-agent/config.env
echo 'TELEGRAM_CHAT_ID=xxx' >> ~/.claude-code-agent/config.env

# 3. Test manuale
~/.claude-code-agent/claude-agent-runner.sh heartbeat

# 4. Installa cron (da root, adatta path se utente diverso da openclaw)
sudo cp config/cron.d/claude-agent /etc/cron.d/
sudo chmod 644 /etc/cron.d/claude-agent
```

## Modalità

| Comando | Descrizione |
|---------|-------------|
| `claude-agent-runner.sh heartbeat` | Checklist HEARTBEAT.md, risponde HEARTBEAT_OK se ok |
| `claude-agent-runner.sh morning` | Report mattutino sistema |
| `claude-agent-runner.sh custom "prompt"` | Esegue prompt custom |

## Integrazione con OpenClaw

Claude Code gira **in parallelo** a OpenClaw. Puoi:
- Lasciare OpenClaw per DeFi/Telegram/cron
- Usare Claude per task analitici più pesanti
- Aggiungere un tool `invoke_claude` in OpenClaw che chiama `claude -p` via shell
