#!/usr/bin/env bash
###############################################################################
# 01-install-ollama.sh
# Installazione Ollama su Raspberry Pi 4 con storage su SSD 1TB
# Eseguire come root: sudo bash 01-install-ollama.sh
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
echo "  PICLAW - Installazione Ollama AI Engine"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# ─── Step 1: Verifica prerequisiti ───────────────────────────────────────────
info "Step 1/7: Verifica prerequisiti..."

# Verifica /data montato
if mountpoint -q /data 2>/dev/null || [[ -d /data ]]; then
    log "/data disponibile"
    DATA_FREE=$(df -BG /data 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G' || echo "0")
    info "Spazio libero su /data: ${DATA_FREE}GB"
else
    warn "/data non montato. Creo directory locale..."
    mkdir -p /data
fi

# Verifica RAM
RAM_TOTAL=$(free -g | awk 'NR==2{print $2}')
log "RAM totale: ${RAM_TOTAL}GB"

if [[ $RAM_TOTAL -lt 4 ]]; then
    warn "RAM sotto 4GB. Performance AI limitata."
fi

# ─── Step 2: Installazione Ollama ────────────────────────────────────────────
info "Step 2/7: Installazione Ollama..."

if command -v ollama &>/dev/null; then
    OLLAMA_VER=$(ollama --version 2>/dev/null || echo "unknown")
    log "Ollama gia' installato: $OLLAMA_VER"
    info "Aggiornamento..."
fi

# Installazione ufficiale (supporta ARM64)
curl -fsSL https://ollama.com/install.sh | sh

# Verifica installazione
if command -v ollama &>/dev/null; then
    OLLAMA_VER=$(ollama --version 2>/dev/null || echo "installed")
    log "Ollama installato: $OLLAMA_VER"
else
    err "Installazione Ollama fallita!"
    exit 1
fi

# ─── Step 3: Configurazione storage su SSD ───────────────────────────────────
info "Step 3/7: Configurazione storage Ollama su SSD..."

# Directory modelli su SSD
OLLAMA_DATA="/data/ollama"
OLLAMA_MODELS="${OLLAMA_DATA}/models"

mkdir -p "$OLLAMA_MODELS"
mkdir -p "${OLLAMA_DATA}/logs"

# Symlink da posizione default a SSD
if [[ -d /usr/share/ollama/.ollama ]] && [[ ! -L /usr/share/ollama/.ollama ]]; then
    mv /usr/share/ollama/.ollama /usr/share/ollama/.ollama.bak 2>/dev/null || true
fi
mkdir -p /usr/share/ollama
ln -sfn "$OLLAMA_DATA" /usr/share/ollama/.ollama 2>/dev/null || true

# Anche per root
if [[ -d /root/.ollama ]] && [[ ! -L /root/.ollama ]]; then
    mv /root/.ollama /root/.ollama.bak 2>/dev/null || true
fi
ln -sfn "$OLLAMA_DATA" /root/.ollama 2>/dev/null || true

log "Storage Ollama configurato su SSD: $OLLAMA_DATA"

# ─── Step 4: Environment file ───────────────────────────────────────────────
info "Step 4/7: Configurazione environment Ollama..."

# Crea environment file per Ollama
cat > /etc/default/ollama << OLLAMA_ENV
# Ollama Environment Configuration for PiClaw
# Storage su SSD 1TB
OLLAMA_MODELS=${OLLAMA_MODELS}
OLLAMA_HOST=0.0.0.0:11434
OLLAMA_ORIGINS=*

# Performance tuning per RPi4 8GB
OLLAMA_NUM_PARALLEL=1
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_KEEP_ALIVE=10m

# Debug (decommentare per troubleshooting)
# OLLAMA_DEBUG=1

# Flash attention (migliore performance su ARM)
OLLAMA_FLASH_ATTENTION=1
OLLAMA_ENV

# Copia anche nella directory config del progetto
cp /etc/default/ollama "${PROJECT_DIR}/config/ollama/ollama.env" 2>/dev/null || true

log "Environment Ollama configurato"

# ─── Step 5: Systemd service ottimizzato ─────────────────────────────────────
info "Step 5/7: Configurazione systemd service Ollama..."

# Ferma il servizio se attivo
systemctl stop ollama 2>/dev/null || true

# Crea/sovrascrivi il service file ottimizzato
cat > /etc/systemd/system/ollama.service << 'OLLAMA_SERVICE'
[Unit]
Description=Ollama AI Engine for PiClaw
Documentation=https://ollama.com
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
ExecStart=/usr/local/bin/ollama serve
EnvironmentFile=/etc/default/ollama

# Restart policy
Restart=always
RestartSec=5
StartLimitIntervalSec=300
StartLimitBurst=10

# Performance
Nice=-5
IOSchedulingClass=realtime
IOSchedulingPriority=0

# Limiti risorse
LimitNOFILE=65535
LimitNPROC=4096
LimitMEMLOCK=infinity

# Memoria: limita a 6GB su 8GB totali (lascia 2GB per OS)
MemoryMax=6G
MemoryHigh=5G

# Timeout
TimeoutStartSec=60
TimeoutStopSec=30

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ollama

[Install]
WantedBy=multi-user.target
OLLAMA_SERVICE

# Copia nella directory config del progetto
cp /etc/systemd/system/ollama.service "${PROJECT_DIR}/config/systemd/" 2>/dev/null || true

systemctl daemon-reload
systemctl enable ollama
log "Systemd service Ollama configurato e abilitato"

# ─── Step 6: Avvio Ollama ───────────────────────────────────────────────────
info "Step 6/7: Avvio Ollama..."

systemctl start ollama
sleep 5

# Verifica che Ollama sia attivo
for i in {1..10}; do
    if curl -s http://localhost:11434/api/version &>/dev/null; then
        OLLAMA_API_VER=$(curl -s http://localhost:11434/api/version | jq -r '.version' 2>/dev/null || echo "active")
        log "Ollama API attiva (versione: $OLLAMA_API_VER)"
        break
    fi
    info "Attesa avvio Ollama... ($i/10)"
    sleep 3
done

if ! curl -s http://localhost:11434/api/version &>/dev/null; then
    err "Ollama API non risponde dopo 30 secondi"
    warn "Verificare: sudo journalctl -u ollama -f"
fi

# ─── Step 7: Verifica storage ───────────────────────────────────────────────
info "Step 7/7: Verifica configurazione storage..."

echo ""
info "Storage Ollama:"
echo "  Directory modelli: $OLLAMA_MODELS"
echo "  Spazio disponibile: $(df -h /data 2>/dev/null | tail -1 | awk '{print $4}' || echo 'N/A')"
echo "  Symlinks:"
ls -la /usr/share/ollama/.ollama 2>/dev/null | head -1 || echo "  N/A"
ls -la /root/.ollama 2>/dev/null | head -1 || echo "  N/A"

# ─── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  OLLAMA INSTALLATO E CONFIGURATO"
echo "============================================================"
echo ""
log "Ollama installato e attivo"
log "Storage su SSD: ${OLLAMA_DATA}"
log "API: http://localhost:11434"
log "Limite memoria: 6GB (di 8GB totali)"
log "Service: ollama.service (auto-start)"
echo ""
info "Comandi utili:"
echo "  ollama list                    # Lista modelli installati"
echo "  ollama pull llama3.2           # Scarica modello"
echo "  ollama run llama3.2            # Esegui modello interattivo"
echo "  sudo systemctl status ollama   # Stato servizio"
echo "  sudo journalctl -u ollama -f   # Log in tempo reale"
echo "  curl http://localhost:11434/api/tags  # Lista modelli via API"
echo ""
info "PROSSIMO STEP:"
info "  sudo bash scripts/04-ai-engine/02-setup-models.sh"
echo ""
