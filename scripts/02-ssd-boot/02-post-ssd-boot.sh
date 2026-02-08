#!/usr/bin/env bash
###############################################################################
# 02-post-ssd-boot.sh
# Verifica e finalizza boot da SSD
# Eseguire come root dopo primo boot da SSD
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

echo ""
echo "============================================================"
echo "  PICLAW - Verifica Post-Boot SSD"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

ERRORS=0

# ─── Verifica boot da SSD ───────────────────────────────────────────────────
info "Verifica sorgente boot..."
ROOT_DEV=$(findmnt -n -o SOURCE /)
ROOT_TYPE=$(lsblk -n -o TRAN "$(echo "$ROOT_DEV" | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//')" 2>/dev/null || echo "unknown")

if echo "$ROOT_DEV" | grep -q "/dev/sd"; then
    log "Boot da SSD: $ROOT_DEV (trasporto: $ROOT_TYPE)"
elif echo "$ROOT_DEV" | grep -q "mmcblk"; then
    err "ANCORA in boot da microSD: $ROOT_DEV"
    err "Il boot da SSD non e' attivo!"
    ERRORS=$((ERRORS + 1))
else
    warn "Dispositivo boot non riconosciuto: $ROOT_DEV"
fi

# ─── Verifica partizioni ────────────────────────────────────────────────────
info "Verifica partizioni montate..."

# Root
ROOT_SIZE=$(df -h / | tail -1 | awk '{print $2}')
ROOT_USED=$(df -h / | tail -1 | awk '{print $5}')
log "Root (/): $ROOT_SIZE totale, $ROOT_USED usato"

# Data
if mountpoint -q /data; then
    DATA_SIZE=$(df -h /data | tail -1 | awk '{print $2}')
    DATA_USED=$(df -h /data | tail -1 | awk '{print $5}')
    log "/data montato: $DATA_SIZE totale, $DATA_USED usato"
else
    warn "/data non montato! Tentativo di mount..."
    mkdir -p /data
    mount /data 2>/dev/null || {
        err "/data non puo' essere montato. Verificare fstab."
        ERRORS=$((ERRORS + 1))
    }
fi

# Boot
if mountpoint -q /boot/firmware; then
    log "/boot/firmware montato ✓"
elif mountpoint -q /boot; then
    log "/boot montato ✓"
fi

# ─── Espandi partizione root se necessario ───────────────────────────────────
info "Verifica dimensione partizione root..."
ROOT_DEV_BASE=$(echo "$ROOT_DEV" | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//')
ROOT_PART_NUM=$(echo "$ROOT_DEV" | grep -o '[0-9]*$')

# Verifica se c'e' spazio non allocato dopo root
# (Solo se root non e' gia' espansa a 200GB)
ROOT_SIZE_BYTES=$(lsblk -b -n -o SIZE "$ROOT_DEV" 2>/dev/null || echo "0")
ROOT_SIZE_GB=$((ROOT_SIZE_BYTES / 1024 / 1024 / 1024))

if [[ $ROOT_SIZE_GB -lt 190 ]]; then
    warn "Root partition: ${ROOT_SIZE_GB}GB (atteso ~200GB)"
    info "Tentativo di espansione..."
    
    # resize2fs per espandere il filesystem
    resize2fs "$ROOT_DEV" 2>/dev/null || {
        warn "resize2fs fallito. Potrebbe essere necessario espandere manualmente."
    }
    
    ROOT_SIZE_BYTES=$(lsblk -b -n -o SIZE "$ROOT_DEV" 2>/dev/null || echo "0")
    ROOT_SIZE_GB=$((ROOT_SIZE_BYTES / 1024 / 1024 / 1024))
    log "Root partition ora: ${ROOT_SIZE_GB}GB"
else
    log "Root partition: ${ROOT_SIZE_GB}GB ✓"
fi

# ─── Verifica performance I/O SSD ───────────────────────────────────────────
info "Test velocita' I/O SSD..."
# Test scrittura sequenziale
WRITE_SPEED=$(dd if=/dev/zero of=/tmp/test_write bs=1M count=256 conv=fdatasync 2>&1 | \
    grep -oP '[\d.]+ [MG]B/s' || echo "N/A")
rm -f /tmp/test_write

# Test lettura sequenziale
echo 3 > /proc/sys/vm/drop_caches
READ_SPEED=$(dd if="$ROOT_DEV" of=/dev/null bs=1M count=256 2>&1 | \
    grep -oP '[\d.]+ [MG]B/s' || echo "N/A")

log "Velocita' scrittura: $WRITE_SPEED"
log "Velocita' lettura: $READ_SPEED"

# ─── Configura struttura /data ───────────────────────────────────────────────
info "Preparazione directory /data..."
mkdir -p /data/{ollama/models,docker,backups,logs,rag/documents,tmp}
chmod 755 /data
log "Directory /data preparata"

# ─── Sposta Docker data su SSD ──────────────────────────────────────────────
info "Configurazione Docker su SSD..."
if command -v docker &>/dev/null; then
    if [[ ! -f /etc/docker/daemon.json ]] || ! grep -q "/data/docker" /etc/docker/daemon.json 2>/dev/null; then
        mkdir -p /etc/docker
        cat > /etc/docker/daemon.json << 'DOCKER_JSON'
{
    "data-root": "/data/docker",
    "storage-driver": "overlay2",
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "10m",
        "max-file": "3"
    }
}
DOCKER_JSON
        systemctl restart docker 2>/dev/null || true
        log "Docker data spostato su /data/docker"
    else
        log "Docker gia' configurato su /data/docker"
    fi
fi

# ─── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  VERIFICA POST-BOOT COMPLETATA"
echo "============================================================"
echo ""

# System info
info "Sistema:"
echo "  Hostname:     $(hostname)"
echo "  Kernel:       $(uname -r)"
echo "  Arch:         $(uname -m)"
echo "  Uptime:       $(uptime -p)"
echo "  CPU Temp:     $(vcgencmd measure_temp 2>/dev/null | cut -d= -f2 || echo 'N/A')"
echo ""

# Storage
info "Storage:"
echo "  Root (/):     $(df -h / | tail -1 | awk '{printf "%s/%s (%s usato)", $3, $2, $5}')"
echo "  Data (/data): $(df -h /data 2>/dev/null | tail -1 | awk '{printf "%s/%s (%s usato)", $3, $2, $5}' || echo 'NON MONTATO')"
echo ""

# RAM
info "Memoria:"
free -h | head -2
echo ""

if [[ $ERRORS -eq 0 ]]; then
    log "Tutte le verifiche passate! Sistema pronto."
    echo ""
    info "PROSSIMO STEP:"
    info "  sudo bash scripts/03-openclaw/01-install-openclaw.sh"
else
    err "$ERRORS errori rilevati. Verificare prima di procedere."
fi
echo ""
