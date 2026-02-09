#!/usr/bin/env bash
###############################################################################
# 01-initial-setup.sh
# Setup iniziale Raspberry Pi OS 64-bit Lite per progetto PiClaw
# Eseguire come root: sudo bash 01-initial-setup.sh
###############################################################################
set -euo pipefail

# ─── Colori output ───────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

# ─── Verifica root ──────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    err "Questo script deve essere eseguito come root (sudo)"
    exit 1
fi

# ─── Verifica Raspberry Pi ──────────────────────────────────────────────────
if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null && \
   ! grep -q "BCM" /proc/cpuinfo 2>/dev/null; then
    warn "Non sembra un Raspberry Pi. Continuo comunque..."
fi

# ─── Verifica architettura 64-bit ───────────────────────────────────────────
ARCH=$(uname -m)
if [[ "$ARCH" != "aarch64" ]]; then
    err "Architettura $ARCH rilevata. Richiesto aarch64 (64-bit)."
    err "Installa Raspberry Pi OS 64-bit Lite."
    exit 1
fi
log "Architettura: $ARCH (64-bit) ✓"

echo ""
echo "============================================================"
echo "  PICLAW - Setup Iniziale Raspberry Pi OS"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# ─── Step 1: Aggiornamento sistema ──────────────────────────────────────────
info "Step 1/9: Aggiornamento completo del sistema..."
apt-get update -y
apt-get full-upgrade -y
apt-get autoremove -y
apt-get autoclean
log "Sistema aggiornato"

# ─── Step 2: Pacchetti essenziali ────────────────────────────────────────────
info "Step 2/9: Installazione pacchetti essenziali..."
PACKAGES=(
    # Build tools
    build-essential
    cmake
    pkg-config
    # System
    htop
    iotop
    lsof
    strace
    sysstat
    # Python
    python3
    python3-pip
    python3-venv
    python3-dev
    python3-gpiozero
    python3-smbus
    python3-rpi.gpio
    # Network
    curl
    wget
    net-tools
    nmap
    dnsutils
    iptables
    # Storage
    parted
    gdisk
    rsync
    pv
    dosfstools
    e2fsprogs
    # Tools
    git
    vim
    tmux
    jq
    bc
    usbutils
    i2c-tools
    # Security
    fail2ban
    ufw
)

apt-get install -y "${PACKAGES[@]}"
log "Pacchetti essenziali installati (${#PACKAGES[@]} pacchetti)"

# ─── Step 3: Abilitazione interfacce hardware ───────────────────────────────
info "Step 3/9: Abilitazione interfacce hardware..."

# Abilita I2C
if ! grep -q "^dtparam=i2c_arm=on" /boot/firmware/config.txt 2>/dev/null; then
    echo "dtparam=i2c_arm=on" >> /boot/firmware/config.txt
    log "I2C abilitato"
else
    log "I2C gia' abilitato"
fi

# Abilita SPI
if ! grep -q "^dtparam=spi=on" /boot/firmware/config.txt 2>/dev/null; then
    echo "dtparam=spi=on" >> /boot/firmware/config.txt
    log "SPI abilitato"
else
    log "SPI gia' abilitato"
fi

# Abilita UART
if ! grep -q "^enable_uart=1" /boot/firmware/config.txt 2>/dev/null; then
    echo "enable_uart=1" >> /boot/firmware/config.txt
    log "UART abilitato"
else
    log "UART gia' abilitato"
fi

# Moduli kernel per I2C e SPI
for mod in i2c-dev i2c-bcm2835 spi-bcm2835; do
    if ! grep -q "^$mod" /etc/modules 2>/dev/null; then
        echo "$mod" >> /etc/modules
    fi
done
log "Moduli kernel hardware configurati"

# ─── Step 4: Configurazione boot USB ────────────────────────────────────────
info "Step 4/9: Configurazione USB boot nel bootloader..."

# Aggiorna firmware EEPROM
if command -v rpi-eeprom-update &>/dev/null; then
    rpi-eeprom-update -a 2>/dev/null || true
    log "EEPROM aggiornato"
    
    # Configura boot order: USB (0x4) first, then SD (0x1)
    # 0xf41 = USB boot -> SD boot -> restart
    if command -v raspi-config &>/dev/null; then
        raspi-config nonint do_boot_order B2 2>/dev/null || true
        log "Boot order configurato: USB first, SD fallback"
    else
        warn "raspi-config non disponibile, configurare boot order manualmente"
    fi
else
    warn "rpi-eeprom-update non disponibile"
fi

# ─── Step 5: Installazione Node.js 20 LTS ───────────────────────────────────
info "Step 5/9: Installazione Node.js 20 LTS..."

if command -v node &>/dev/null; then
    NODE_VER=$(node --version)
    log "Node.js gia' installato: $NODE_VER"
else
    # NodeSource repository per ARM64
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    
    # Verifica
    NODE_VER=$(node --version)
    NPM_VER=$(npm --version)
    log "Node.js $NODE_VER installato (npm $NPM_VER)"
fi

# Installa yarn e pnpm globalmente
npm install -g yarn pnpm 2>/dev/null || true
log "Yarn e pnpm installati globalmente"

# ─── Step 6: Installazione Docker CE ────────────────────────────────────────
info "Step 6/9: Installazione Docker CE..."

if command -v docker &>/dev/null; then
    DOCKER_VER=$(docker --version)
    log "Docker gia' installato: $DOCKER_VER"
else
    curl -fsSL https://get.docker.com | sh
    
    # Aggiungi utente pi al gruppo docker
    usermod -aG docker pi 2>/dev/null || true
    
    # Abilita e avvia Docker
    systemctl enable docker
    systemctl start docker
    
    DOCKER_VER=$(docker --version)
    log "Docker installato: $DOCKER_VER"
fi

# Docker Compose (plugin)
if ! docker compose version &>/dev/null 2>&1; then
    apt-get install -y docker-compose-plugin 2>/dev/null || true
    log "Docker Compose plugin installato"
fi

# ─── Step 7: Configurazione swap ottimale ────────────────────────────────────
info "Step 7/9: Configurazione swap ottimale per 8GB RAM..."

# Per AI inference, swap e' critico come fallback
SWAP_SIZE=4096  # 4GB swap su SSD (verra' spostato dopo migrazione)

# Disabilita swap corrente
dphys-swapfile swapoff 2>/dev/null || true

# Configura nuovo swap
if [[ -f /etc/dphys-swapfile ]]; then
    sed -i "s/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=${SWAP_SIZE}/" /etc/dphys-swapfile
    sed -i "s/^#CONF_SWAPSIZE=.*/CONF_SWAPSIZE=${SWAP_SIZE}/" /etc/dphys-swapfile
    
    # Se su SD, limita. Su SSD sara' ok
    sed -i "s/^CONF_MAXSWAP=.*/CONF_MAXSWAP=${SWAP_SIZE}/" /etc/dphys-swapfile
fi

dphys-swapfile setup 2>/dev/null || true
dphys-swapfile swapon 2>/dev/null || true

# Swappiness bassa (preferisci RAM)
echo "vm.swappiness=10" > /etc/sysctl.d/99-piclaw-swap.conf
sysctl -p /etc/sysctl.d/99-piclaw-swap.conf 2>/dev/null || true

log "Swap configurato: ${SWAP_SIZE}MB, swappiness=10"

# ─── Step 8: Configurazione performance ─────────────────────────────────────
info "Step 8/9: Ottimizzazioni performance..."

# Configura governor CPU su performance
cat > /etc/sysctl.d/99-piclaw-perf.conf << 'SYSCTL'
# PiClaw Performance Tuning
vm.swappiness=10
vm.dirty_ratio=15
vm.dirty_background_ratio=5
vm.vfs_cache_pressure=50
net.core.somaxconn=1024
net.ipv4.tcp_max_syn_backlog=1024
fs.file-max=100000
fs.inotify.max_user_watches=524288
SYSCTL
sysctl -p /etc/sysctl.d/99-piclaw-perf.conf 2>/dev/null || true

# Limiti file aperti
cat > /etc/security/limits.d/99-piclaw.conf << 'LIMITS'
*    soft    nofile    65535
*    hard    nofile    65535
root soft    nofile    65535
root hard    nofile    65535
LIMITS

# GPU memory minimo (non serve per headless)
if ! grep -q "gpu_mem=" /boot/firmware/config.txt 2>/dev/null; then
    echo "gpu_mem=16" >> /boot/firmware/config.txt
    log "GPU memory ridotta a 16MB (headless)"
fi

# Overclock conservativo (opzionale, decommentare se si ha buon raffreddamento)
# echo "over_voltage=6" >> /boot/firmware/config.txt
# echo "arm_freq=2000" >> /boot/firmware/config.txt

log "Ottimizzazioni performance applicate"

# ─── Step 9: Sicurezza base ─────────────────────────────────────────────────
info "Step 9/9: Hardening sicurezza base..."

# Configura fail2ban
systemctl enable fail2ban 2>/dev/null || true
systemctl start fail2ban 2>/dev/null || true

# UFW firewall - regole base
ufw default deny incoming 2>/dev/null || true
ufw default allow outgoing 2>/dev/null || true
ufw allow ssh 2>/dev/null || true
ufw allow 11434/tcp comment 'Ollama API' 2>/dev/null || true
# Non abilitare UFW automaticamente per evitare lockout
# ufw --force enable
warn "UFW configurato ma NON abilitato. Esegui 'sudo ufw enable' manualmente dopo verifica."

# Disabilita servizi non necessari
systemctl disable bluetooth 2>/dev/null || true
systemctl disable hciuart 2>/dev/null || true
systemctl disable avahi-daemon 2>/dev/null || true
log "Servizi non necessari disabilitati"

# ─── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  SETUP INIZIALE COMPLETATO"
echo "============================================================"
echo ""
log "Sistema aggiornato e pacchetti installati"
log "Interfacce hardware abilitate (I2C, SPI, UART, GPIO)"
log "USB boot configurato nel bootloader"
log "Node.js $(node --version 2>/dev/null || echo 'N/A') installato"
log "Docker $(docker --version 2>/dev/null | cut -d' ' -f3 | tr -d ',' || echo 'N/A') installato"
log "Swap: ${SWAP_SIZE}MB, swappiness: 10"
log "Performance tuning applicato"
log "Sicurezza base configurata"
echo ""
warn "PROSSIMO STEP: Collegare SSD USB 3.0 ed eseguire:"
info "  sudo bash scripts/02-ssd-boot/01-prepare-ssd.sh"
echo ""
warn "REBOOT consigliato prima di procedere:"
info "  sudo reboot"
echo ""
