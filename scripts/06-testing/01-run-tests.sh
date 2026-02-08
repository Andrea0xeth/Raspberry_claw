#!/usr/bin/env bash
###############################################################################
# 01-run-tests.sh
# Suite di test completa per validare installazione PiClaw
# Eseguire come root: sudo bash 01-run-tests.sh
###############################################################################
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0
SKIP=0

pass() { echo -e "  ${GREEN}PASS${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAIL=$((FAIL + 1)); }
warning() { echo -e "  ${YELLOW}WARN${NC} $1"; WARN=$((WARN + 1)); }
skip() { echo -e "  ${BLUE}SKIP${NC} $1"; SKIP=$((SKIP + 1)); }

section() { echo -e "\n${BOLD}═══ $1 ═══${NC}"; }

echo ""
echo "============================================================"
echo "  PICLAW - Suite Test Completa"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# ─── TEST 1: Hardware ───────────────────────────────────────────────────────
section "TEST 1: Hardware"

# Architettura
if [[ "$(uname -m)" == "aarch64" ]]; then
    pass "Architettura: aarch64 (64-bit)"
else
    fail "Architettura: $(uname -m) (atteso aarch64)"
fi

# RAM
RAM_GB=$(free -g | awk 'NR==2{print $2}')
if [[ $RAM_GB -ge 7 ]]; then
    pass "RAM: ${RAM_GB}GB (>= 7GB, OK per 8GB model)"
elif [[ $RAM_GB -ge 3 ]]; then
    warning "RAM: ${RAM_GB}GB (sufficiente, ma limitata)"
else
    fail "RAM: ${RAM_GB}GB (insufficiente)"
fi

# CPU
CPU_CORES=$(nproc)
pass "CPU: $CPU_CORES cores"

# Temperatura
if command -v vcgencmd &>/dev/null; then
    TEMP=$(vcgencmd measure_temp 2>/dev/null | cut -d= -f2 || echo "N/A")
    TEMP_NUM=$(echo "$TEMP" | grep -oP '[\d.]+' || echo "0")
    if (( $(echo "$TEMP_NUM < 70" | bc -l 2>/dev/null || echo "1") )); then
        pass "Temperatura CPU: $TEMP"
    elif (( $(echo "$TEMP_NUM < 80" | bc -l 2>/dev/null || echo "1") )); then
        warning "Temperatura CPU: $TEMP (alta)"
    else
        fail "Temperatura CPU: $TEMP (CRITICA)"
    fi
else
    skip "Temperatura CPU: vcgencmd non disponibile"
fi

# ─── TEST 2: Storage / SSD ──────────────────────────────────────────────────
section "TEST 2: Storage / SSD Boot"

# Boot da SSD
ROOT_DEV=$(findmnt -n -o SOURCE /)
if echo "$ROOT_DEV" | grep -q "/dev/sd"; then
    pass "Boot da SSD: $ROOT_DEV"
elif echo "$ROOT_DEV" | grep -q "mmcblk"; then
    warning "Boot da microSD: $ROOT_DEV (migrazione SSD non completata?)"
else
    warning "Boot device: $ROOT_DEV (non riconosciuto)"
fi

# Dimensione root
ROOT_SIZE_GB=$(df -BG / | tail -1 | awk '{print $2}' | tr -d 'G')
if [[ $ROOT_SIZE_GB -ge 100 ]]; then
    pass "Root partition: ${ROOT_SIZE_GB}GB"
else
    warning "Root partition: ${ROOT_SIZE_GB}GB (atteso >= 100GB)"
fi

# /data montato
if mountpoint -q /data 2>/dev/null; then
    DATA_SIZE=$(df -h /data | tail -1 | awk '{print $2}')
    DATA_FREE=$(df -h /data | tail -1 | awk '{print $4}')
    pass "/data montato: ${DATA_SIZE} totale, ${DATA_FREE} libero"
elif [[ -d /data ]]; then
    warning "/data esiste ma non e' un mount point separato"
else
    fail "/data non esiste"
fi

# UASP
ROOT_DEV_BASE=$(echo "$ROOT_DEV" | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//')
UASP=$(udevadm info --query=property --name="$ROOT_DEV_BASE" 2>/dev/null | grep "ID_USB_DRIVER" || echo "")
if echo "$UASP" | grep -qi "uas"; then
    pass "UASP: attivo"
else
    if echo "$ROOT_DEV" | grep -q "/dev/sd"; then
        warning "UASP: non rilevato (prestazioni sub-ottimali)"
    else
        skip "UASP: non applicabile (non USB)"
    fi
fi

# I/O Scheduler
ROOT_DEV_NAME=$(basename "$ROOT_DEV_BASE")
if [[ -f "/sys/block/${ROOT_DEV_NAME}/queue/scheduler" ]]; then
    SCHED=$(cat "/sys/block/${ROOT_DEV_NAME}/queue/scheduler" 2>/dev/null)
    if echo "$SCHED" | grep -q "\[none\]\|\[noop\]"; then
        pass "I/O scheduler: none/noop (ottimale per SSD)"
    else
        warning "I/O scheduler: $SCHED (consigliato: none)"
    fi
else
    skip "I/O scheduler: non verificabile"
fi

# fstrim timer
if systemctl is-enabled fstrim.timer &>/dev/null; then
    pass "TRIM timer: abilitato"
else
    warning "TRIM timer: non abilitato"
fi

# ─── TEST 3: Software Base ──────────────────────────────────────────────────
section "TEST 3: Software Base"

# Node.js
if command -v node &>/dev/null; then
    NODE_VER=$(node --version)
    pass "Node.js: $NODE_VER"
else
    fail "Node.js: non installato"
fi

# npm
if command -v npm &>/dev/null; then
    NPM_VER=$(npm --version)
    pass "npm: $NPM_VER"
else
    fail "npm: non installato"
fi

# Docker
if command -v docker &>/dev/null; then
    DOCKER_VER=$(docker --version 2>/dev/null | cut -d' ' -f3 | tr -d ',')
    if docker info &>/dev/null; then
        pass "Docker: $DOCKER_VER (running)"
    else
        warning "Docker: $DOCKER_VER (non running o permessi)"
    fi
else
    fail "Docker: non installato"
fi

# Python
if command -v python3 &>/dev/null; then
    PY_VER=$(python3 --version)
    pass "Python: $PY_VER"
else
    fail "Python3: non installato"
fi

# Git
if command -v git &>/dev/null; then
    pass "Git: $(git --version | cut -d' ' -f3)"
else
    fail "Git: non installato"
fi

# ─── TEST 4: Ollama ─────────────────────────────────────────────────────────
section "TEST 4: Ollama AI Engine"

# Ollama installato
if command -v ollama &>/dev/null; then
    OLLAMA_VER=$(ollama --version 2>/dev/null || echo "installed")
    pass "Ollama: $OLLAMA_VER"
else
    fail "Ollama: non installato"
fi

# Ollama service
if systemctl is-active ollama &>/dev/null; then
    pass "Ollama service: attivo"
else
    fail "Ollama service: non attivo"
fi

# Ollama API
if curl -s -o /dev/null -w "%{http_code}" http://localhost:11434/api/version 2>/dev/null | grep -q "200"; then
    OLLAMA_API_VER=$(curl -s http://localhost:11434/api/version 2>/dev/null | jq -r '.version' 2>/dev/null || echo "ok")
    pass "Ollama API: raggiungibile (v$OLLAMA_API_VER)"
else
    fail "Ollama API: non raggiungibile (http://localhost:11434)"
fi

# Modello piclaw-agent
if ollama list 2>/dev/null | grep -q "piclaw-agent"; then
    MODEL_SIZE=$(ollama list 2>/dev/null | grep "piclaw-agent" | awk '{print $3, $4}')
    pass "Modello piclaw-agent: installato ($MODEL_SIZE)"
else
    fail "Modello piclaw-agent: non trovato"
fi

# Modello piclaw-coder
if ollama list 2>/dev/null | grep -q "piclaw-coder"; then
    pass "Modello piclaw-coder: installato"
else
    warning "Modello piclaw-coder: non trovato (opzionale)"
fi

# Storage modelli su SSD
if [[ -d /data/ollama/models ]]; then
    MODELS_SIZE=$(du -sh /data/ollama/models 2>/dev/null | awk '{print $1}')
    pass "Modelli su SSD: /data/ollama/models ($MODELS_SIZE)"
else
    fail "Directory modelli SSD: non trovata"
fi

# ─── TEST 5: OpenClaw ───────────────────────────────────────────────────────
section "TEST 5: OpenClaw Agent"

# Utente openclaw
if id openclaw &>/dev/null; then
    GROUPS=$(id -Gn openclaw 2>/dev/null)
    pass "Utente 'openclaw' esiste (gruppi: $GROUPS)"
else
    fail "Utente 'openclaw' non esiste"
fi

# Sudoers
if [[ -f /etc/sudoers.d/openclaw ]]; then
    if visudo -c -f /etc/sudoers.d/openclaw &>/dev/null; then
        pass "Sudoers NOPASSWD: configurato e valido"
    else
        fail "Sudoers: file corrotto"
    fi
else
    fail "Sudoers: /etc/sudoers.d/openclaw non trovato"
fi

# Test sudo NOPASSWD
if sudo -u openclaw sudo -n true 2>/dev/null; then
    pass "Sudo NOPASSWD: funzionante"
else
    warning "Sudo NOPASSWD: non verificabile (potrebbe funzionare come root)"
fi

# OpenClaw service
if systemctl is-active openclaw &>/dev/null; then
    pass "OpenClaw service: attivo"
else
    if systemctl is-enabled openclaw &>/dev/null; then
        warning "OpenClaw service: abilitato ma non attivo"
    else
        fail "OpenClaw service: non configurato"
    fi
fi

# OpenClaw API
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/health 2>/dev/null | grep -q "200"; then
    pass "OpenClaw API: raggiungibile (http://localhost:3100)"
else
    fail "OpenClaw API: non raggiungibile"
fi

# Tools disponibili
TOOLS_RESPONSE=$(curl -s http://localhost:3100/tools 2>/dev/null || echo "{}")
TOOLS_COUNT=$(echo "$TOOLS_RESPONSE" | jq -r '.tools | length' 2>/dev/null || echo "0")
if [[ $TOOLS_COUNT -gt 0 ]]; then
    pass "OpenClaw tools: $TOOLS_COUNT disponibili"
else
    warning "OpenClaw tools: non verificabili"
fi

# ─── TEST 6: Hardware Interfaces ────────────────────────────────────────────
section "TEST 6: Interfacce Hardware"

# I2C
if [[ -e /dev/i2c-1 ]]; then
    pass "I2C: /dev/i2c-1 disponibile"
else
    if grep -q "i2c" /boot/firmware/config.txt 2>/dev/null; then
        warning "I2C: abilitato in config ma device non presente"
    else
        skip "I2C: non abilitato"
    fi
fi

# SPI
if [[ -e /dev/spidev0.0 ]]; then
    pass "SPI: /dev/spidev0.0 disponibile"
else
    skip "SPI: device non presente"
fi

# GPIO
if [[ -d /sys/class/gpio ]]; then
    pass "GPIO sysfs: disponibile"
else
    skip "GPIO sysfs: non disponibile"
fi

# UART
if [[ -e /dev/serial0 ]] || [[ -e /dev/ttyS0 ]]; then
    pass "UART: disponibile"
else
    skip "UART: non disponibile"
fi

# ─── TEST 7: AI Decision Test ───────────────────────────────────────────────
section "TEST 7: AI Decision Engine"

if curl -s http://localhost:3100/health &>/dev/null && \
   curl -s http://localhost:11434/api/version &>/dev/null; then
    
    info "Test decisione AI: 'Batteria bassa, gestisci shutdown sicuro'..."
    
    DECISION_RESPONSE=$(curl -s -X POST http://localhost:3100/decide \
        -H "Content-Type: application/json" \
        -d '{
            "prompt": "Simula scenario: batteria bassa al 5%. Analizza e suggerisci azioni per shutdown sicuro del sistema. Non eseguire realmente lo shutdown.",
            "execute": false
        }' --max-time 120 2>/dev/null || echo '{"error":"timeout"}')
    
    if echo "$DECISION_RESPONSE" | jq -e '.decision.analysis' &>/dev/null; then
        ANALYSIS=$(echo "$DECISION_RESPONSE" | jq -r '.decision.analysis' 2>/dev/null | head -c 200)
        PRIORITY=$(echo "$DECISION_RESPONSE" | jq -r '.decision.priority' 2>/dev/null)
        ACTIONS=$(echo "$DECISION_RESPONSE" | jq -r '.decision.actions | length' 2>/dev/null || echo "0")
        
        pass "AI Decision: risposta ricevuta"
        echo -e "    ${BLUE}Analisi:${NC} $ANALYSIS"
        echo -e "    ${BLUE}Priorita':${NC} $PRIORITY"
        echo -e "    ${BLUE}Azioni suggerite:${NC} $ACTIONS"
    else
        ERROR=$(echo "$DECISION_RESPONSE" | jq -r '.error' 2>/dev/null || echo "unknown")
        if [[ "$ERROR" == "timeout" ]]; then
            warning "AI Decision: timeout (modello potrebbe richiedere piu' tempo)"
        else
            fail "AI Decision: risposta non strutturata ($ERROR)"
        fi
    fi
    
    # Test tool shell via API
    info "Test tool shell via OpenClaw API..."
    SHELL_RESPONSE=$(curl -s -X POST http://localhost:3100/tool/shell \
        -H "Content-Type: application/json" \
        -d '{"command": "echo PiClaw test OK && whoami && date"}' \
        --max-time 10 2>/dev/null || echo '{"error":"timeout"}')
    
    if echo "$SHELL_RESPONSE" | jq -e '.success' &>/dev/null; then
        SHELL_OUT=$(echo "$SHELL_RESPONSE" | jq -r '.stdout' 2>/dev/null | head -1)
        pass "Tool shell: funzionante ($SHELL_OUT)"
    else
        fail "Tool shell: non funzionante"
    fi
    
    # Test system_info via API
    info "Test tool system_info via OpenClaw API..."
    SYSINFO_RESPONSE=$(curl -s http://localhost:3100/system --max-time 10 2>/dev/null || echo '{"error":"timeout"}')
    
    if echo "$SYSINFO_RESPONSE" | jq -e '.success' &>/dev/null; then
        CPU_USE=$(echo "$SYSINFO_RESPONSE" | jq -r '.cpu_usage' 2>/dev/null)
        MEM_USE=$(echo "$SYSINFO_RESPONSE" | jq -r '.memory' 2>/dev/null)
        pass "Tool system_info: CPU=$CPU_USE, MEM=$MEM_USE"
    else
        fail "Tool system_info: non funzionante"
    fi
else
    skip "AI Decision: OpenClaw o Ollama non attivi"
fi

# ─── TEST 8: Performance ────────────────────────────────────────────────────
section "TEST 8: Performance"

# Swap
SWAP_TOTAL=$(free -m | awk '/Swap/{print $2}')
if [[ $SWAP_TOTAL -ge 2000 ]]; then
    pass "Swap: ${SWAP_TOTAL}MB configurato"
else
    warning "Swap: ${SWAP_TOTAL}MB (consigliato >= 2000MB)"
fi

# Swappiness
SWAPPINESS=$(cat /proc/sys/vm/swappiness)
if [[ $SWAPPINESS -le 20 ]]; then
    pass "Swappiness: $SWAPPINESS (ottimale)"
else
    warning "Swappiness: $SWAPPINESS (consigliato <= 20)"
fi

# File limits
FILE_MAX=$(cat /proc/sys/fs/file-max)
if [[ $FILE_MAX -ge 100000 ]]; then
    pass "File max: $FILE_MAX"
else
    warning "File max: $FILE_MAX (consigliato >= 100000)"
fi

# GPU memory (headless)
if command -v vcgencmd &>/dev/null; then
    GPU_MEM=$(vcgencmd get_mem gpu 2>/dev/null | grep -oP '\d+' || echo "N/A")
    if [[ "$GPU_MEM" != "N/A" ]] && [[ $GPU_MEM -le 64 ]]; then
        pass "GPU memory: ${GPU_MEM}MB (minimo, ottimale per headless)"
    else
        warning "GPU memory: ${GPU_MEM}MB (ridurre per headless)"
    fi
else
    skip "GPU memory: non verificabile"
fi

# ─── TEST 9: Security ───────────────────────────────────────────────────────
section "TEST 9: Sicurezza"

# fail2ban
if systemctl is-active fail2ban &>/dev/null; then
    pass "fail2ban: attivo"
else
    warning "fail2ban: non attivo"
fi

# SSH
if systemctl is-active ssh &>/dev/null || systemctl is-active sshd &>/dev/null; then
    pass "SSH: attivo"
else
    warning "SSH: non attivo"
fi

# Firewall
if command -v ufw &>/dev/null; then
    UFW_STATUS=$(ufw status 2>/dev/null | head -1 || echo "unknown")
    if echo "$UFW_STATUS" | grep -q "active"; then
        pass "UFW firewall: $UFW_STATUS"
    else
        warning "UFW firewall: $UFW_STATUS (consigliato abilitare)"
    fi
else
    skip "UFW: non installato"
fi

# ─── RIEPILOGO ───────────────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL + WARN + SKIP))

echo ""
echo "============================================================"
echo "  RISULTATI TEST"
echo "============================================================"
echo ""
echo -e "  ${GREEN}PASS:${NC} $PASS"
echo -e "  ${RED}FAIL:${NC} $FAIL"
echo -e "  ${YELLOW}WARN:${NC} $WARN"
echo -e "  ${BLUE}SKIP:${NC} $SKIP"
echo -e "  ${BOLD}TOTALE:${NC} $TOTAL"
echo ""

if [[ $FAIL -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}  ✓ TUTTI I TEST CRITICI PASSATI${NC}"
    echo ""
    if [[ $WARN -gt 0 ]]; then
        echo -e "  ${YELLOW}$WARN warning da verificare (non bloccanti)${NC}"
    fi
else
    echo -e "${RED}${BOLD}  ✗ $FAIL TEST FALLITI - VERIFICARE${NC}"
fi

echo ""
echo "============================================================"
echo "  PiClaw Setup $([ $FAIL -eq 0 ] && echo 'COMPLETATO' || echo 'INCOMPLETO')"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# Exit code basato sui fallimenti
exit $FAIL
