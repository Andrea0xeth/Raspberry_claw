#!/usr/bin/env bash
###############################################################################
# 02-setup-models.sh
# Download e configurazione modelli AI per PiClaw
# Eseguire come root: sudo bash 02-setup-models.sh
###############################################################################
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

if [[ $EUID -ne 0 ]]; then
    err "Eseguire come root: sudo bash $0"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo ""
echo "============================================================"
echo "  PICLAW - Setup Modelli AI"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# ─── Verifica Ollama attivo ──────────────────────────────────────────────────
info "Verifica Ollama..."
if ! curl -s http://localhost:11434/api/version &>/dev/null; then
    err "Ollama non raggiungibile. Avviare prima il servizio."
    info "sudo systemctl start ollama"
    exit 1
fi
log "Ollama attivo"

# ─── Verifica spazio disponibile ─────────────────────────────────────────────
DATA_FREE_GB=$(df -BG /data 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G' || echo "0")
info "Spazio disponibile su /data: ${DATA_FREE_GB}GB"

if [[ $DATA_FREE_GB -lt 10 ]]; then
    err "Spazio insufficiente su /data (< 10GB). Liberare spazio."
    exit 1
fi

# ─── Step 1: Download modello base ──────────────────────────────────────────
info "Step 1/4: Download modello base Llama 3.2..."
echo ""

# Determina il miglior modello in base alla RAM disponibile
RAM_FREE_GB=$(free -g | awk 'NR==2{print $7}')
RAM_TOTAL_GB=$(free -g | awk 'NR==2{print $2}')

info "RAM disponibile: ${RAM_FREE_GB}GB liberi / ${RAM_TOTAL_GB}GB totali"

# Selezione modello
# - 8B Q4_K_M: ~4.7GB, richiede ~5GB RAM → OK per 8GB Pi
# - 3B Q4_K_M: ~2.0GB, richiede ~3GB RAM → Piu' veloce
# - 1B Q4_K_M: ~0.8GB, richiede ~2GB RAM → Ultra veloce
if [[ $RAM_TOTAL_GB -ge 7 ]]; then
    BASE_MODEL="llama3.2:3b"
    ALT_MODEL="llama3.2:1b"
    info "RPi 8GB rilevato. Modello principale: $BASE_MODEL"
    info "Modello secondario (veloce): $ALT_MODEL"
else
    BASE_MODEL="llama3.2:1b"
    ALT_MODEL=""
    info "RAM limitata. Modello: $BASE_MODEL"
fi

# Download modello principale
info "Downloading $BASE_MODEL (questo richiede tempo)..."
ollama pull "$BASE_MODEL" || {
    err "Download $BASE_MODEL fallito. Tentativo con modello piu' piccolo..."
    BASE_MODEL="llama3.2:1b"
    ollama pull "$BASE_MODEL"
}
log "Modello $BASE_MODEL scaricato"

# Download modello secondario (se applicabile)
if [[ -n "$ALT_MODEL" ]]; then
    info "Downloading modello secondario $ALT_MODEL..."
    ollama pull "$ALT_MODEL" || warn "Download $ALT_MODEL fallito (non critico)"
    log "Modello $ALT_MODEL scaricato"
fi

# ─── Step 2: Crea Modelfile custom per agente decisionale ────────────────────
info "Step 2/4: Creazione modello custom 'piclaw-agent'..."

MODELFILE_PATH="${PROJECT_DIR}/models/Modelfile.piclaw-agent"

cat > "$MODELFILE_PATH" << MODELFILE
# PiClaw Agent - Modello decisionale autonomo per Raspberry Pi 4
# Basato su $BASE_MODEL con system prompt personalizzato

FROM ${BASE_MODEL}

# System prompt per agente decisionale autonomo
SYSTEM """Sei PiClaw, un agente AI autonomo e proattivo che opera su un Raspberry Pi 4 (8GB RAM, 1TB SSD).

HAI ACCESSO COMPLETO AL SISTEMA:
- Esecuzione comandi shell (bash) con privilegi root/sudo
- Controllo GPIO pins (lettura/scrittura digitale, PWM, I2C, SPI)
- Gestione completa filesystem (lettura, scrittura, permessi, mount)
- Monitoring sistema (CPU, RAM, temperatura, storage, processi, rete)
- Gestione servizi systemd (start, stop, restart, enable)
- Configurazione rete (IP, firewall, DNS, routing)
- Gestione Docker containers
- Accesso hardware diretto via /dev e /sys

PROTOCOLLO DECISIONALE:
1. ANALIZZA: Raccogli tutti i dati rilevanti sul problema o richiesta
2. PIANIFICA: Definisci una sequenza di passi concreti e verificabili
3. ESEGUI: Usa i tool disponibili per implementare il piano
4. VERIFICA: Controlla che ogni azione abbia avuto successo
5. RIPORTA: Comunica risultato, problemi incontrati, e stato finale

COMPORTAMENTO PROATTIVO:
- Se rilevi temperatura CPU > 75°C: riduci carico, attiva ventola se disponibile
- Se disco > 90% pieno: identifica e suggerisci file da rimuovere
- Se un servizio critico e' down: tenta restart automatico
- Se la rete e' disconnessa: diagnosi e tentativo di riconnessione
- Se la RAM e' > 90%: identifica processi memory-hungry

FORMATO RISPOSTA per decisioni strutturate (JSON):
{
    "analysis": "descrizione analisi situazione",
    "plan": ["step 1", "step 2", "step 3"],
    "actions": [
        {"tool": "shell", "params": {"command": "comando da eseguire"}},
        {"tool": "system_info", "params": {}},
        {"tool": "gpio", "params": {"pin": 17, "action": "read"}}
    ],
    "priority": "low|medium|high|critical",
    "explanation": "spiegazione della decisione presa"
}

REGOLE:
- Sii CONCISO e PRATICO nelle risposte
- Preferisci azioni sicure e reversibili
- Logga sempre le azioni importanti
- In caso di dubbio su azioni distruttive, chiedi conferma
- Mantieni il sistema stabile e performante
"""

# Parametri di inferenza ottimizzati per decisioni
PARAMETER temperature 0.3
PARAMETER num_ctx 4096
PARAMETER num_predict 2048
PARAMETER top_p 0.9
PARAMETER top_k 40
PARAMETER repeat_penalty 1.1
PARAMETER stop "<|eot_id|>"
PARAMETER stop "<|end|>"

# Template per Llama 3.2
TEMPLATE """{{ if .System }}<|start_header_id|>system<|end_header_id|>

{{ .System }}<|eot_id|>{{ end }}{{ if .Prompt }}<|start_header_id|>user<|end_header_id|>

{{ .Prompt }}<|eot_id|>{{ end }}<|start_header_id|>assistant<|end_header_id|>

{{ .Response }}<|eot_id|>"""
MODELFILE

log "Modelfile agente decisionale creato"

# Crea il modello custom in Ollama
info "Building modello 'piclaw-agent' in Ollama..."
ollama create piclaw-agent -f "$MODELFILE_PATH" || {
    err "Creazione modello fallita!"
    warn "Verificare che $BASE_MODEL sia scaricato correttamente"
    exit 1
}
log "Modello 'piclaw-agent' creato in Ollama"

# ─── Step 3: Crea Modelfile per coding assistant ────────────────────────────
info "Step 3/4: Creazione modello 'piclaw-coder'..."

CODER_MODELFILE="${PROJECT_DIR}/models/Modelfile.piclaw-coder"

cat > "$CODER_MODELFILE" << MODELFILE_CODER
# PiClaw Coder - Assistente codice per Raspberry Pi
FROM ${BASE_MODEL}

SYSTEM """Sei PiClaw Coder, un assistente di programmazione specializzato per Raspberry Pi.

SPECIALIZZAZIONI:
- Python (GPIO, I2C, SPI, sensori, automazione)
- Bash scripting (system administration, cron, systemd)
- Node.js (API, WebSocket, automazione)
- C/C++ (performance-critical, hardware access)
- Docker (containerizzazione servizi)

CONTESTO:
- Raspberry Pi 4 con 8GB RAM e 1TB SSD
- Raspberry Pi OS 64-bit (Bookworm, Debian 12)
- Python 3.11+, Node.js 20 LTS, Docker CE
- Hardware: GPIO 40 pin, I2C, SPI, UART

Genera codice COMPLETO, FUNZIONANTE, con commenti in italiano.
Includi sempre error handling e logging.
Ottimizza per le risorse limitate del Pi (RAM, CPU ARM).
"""

PARAMETER temperature 0.2
PARAMETER num_ctx 4096
PARAMETER num_predict 4096
PARAMETER top_p 0.95
PARAMETER repeat_penalty 1.05
MODELFILE_CODER

ollama create piclaw-coder -f "$CODER_MODELFILE" 2>/dev/null || {
    warn "Creazione piclaw-coder fallita (non critico)"
}
log "Modello 'piclaw-coder' creato"

# ─── Step 4: Test modelli ───────────────────────────────────────────────────
info "Step 4/4: Test rapido modelli..."

# Test piclaw-agent
info "Test piclaw-agent..."
RESPONSE=$(curl -s -X POST http://localhost:11434/api/generate \
    -H "Content-Type: application/json" \
    -d '{
        "model": "piclaw-agent",
        "prompt": "Rispondi solo con: OK AGENT READY",
        "stream": false,
        "options": {"num_predict": 20}
    }' --max-time 120 2>/dev/null || echo '{"response":"timeout"}')

AGENT_RESP=$(echo "$RESPONSE" | jq -r '.response' 2>/dev/null | head -1 || echo "no response")
if [[ -n "$AGENT_RESP" ]] && [[ "$AGENT_RESP" != "timeout" ]] && [[ "$AGENT_RESP" != "no response" ]]; then
    log "piclaw-agent risponde: $(echo "$AGENT_RESP" | head -c 100)"
else
    warn "piclaw-agent non ha risposto (potrebbe richiedere piu' tempo al primo avvio)"
fi

# ─── Lista modelli installati ────────────────────────────────────────────────
echo ""
info "Modelli installati:"
ollama list 2>/dev/null || true

# ─── Verifica spazio utilizzato ──────────────────────────────────────────────
echo ""
MODELS_SIZE=$(du -sh /data/ollama/models 2>/dev/null | awk '{print $1}' || echo "N/A")
info "Spazio modelli: $MODELS_SIZE"
info "Spazio libero /data: $(df -h /data 2>/dev/null | tail -1 | awk '{print $4}' || echo 'N/A')"

# ─── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  MODELLI AI CONFIGURATI"
echo "============================================================"
echo ""
log "Modello base: $BASE_MODEL"
log "Modello agente: piclaw-agent (decisioni autonome)"
log "Modello coder: piclaw-coder (assistente codice)"
log "Storage modelli: /data/ollama/models"
echo ""
info "Test manuale:"
echo "  ollama run piclaw-agent 'Analizza lo stato del sistema'"
echo "  ollama run piclaw-coder 'Scrivi uno script Python per leggere GPIO 17'"
echo ""
info "PROSSIMO STEP:"
info "  sudo bash scripts/05-optimization/01-ssd-optimize.sh"
echo ""
