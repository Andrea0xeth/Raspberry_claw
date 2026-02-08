#!/usr/bin/env bash
###############################################################################
# 00-configure-ssh.sh
# Configurazione e hardening SSH sul Raspberry Pi.
# DA ESEGUIRE SUL PI dopo il primo collegamento SSH.
#
# Cosa fa:
#   1. Configura chiave pubblica del Mac (se presente sulla boot partition)
#   2. Hardening sshd_config (key-only, no root login, etc.)
#   3. Configura fail2ban per SSH
#   4. Setup banner e MOTD personalizzato
#   5. Opzionale: porta SSH custom
#
# Uso: sudo bash scripts/01-os-setup/00-configure-ssh.sh
###############################################################################
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
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
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  PICLAW - Configurazione SSH${NC}"
echo -e "${BOLD}  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""

# Rileva utente principale (non root)
MAIN_USER=$(ls /home/ | head -1)
if [[ -z "$MAIN_USER" ]]; then
    MAIN_USER="pi"
fi
MAIN_HOME="/home/$MAIN_USER"
info "Utente principale rilevato: $MAIN_USER"

# ─── Step 1: Setup chiave pubblica SSH ───────────────────────────────────────
info "Step 1/5: Configurazione chiave pubblica SSH..."

mkdir -p "${MAIN_HOME}/.ssh"
chmod 700 "${MAIN_HOME}/.ssh"

KEYS_ADDED=0

# Cerca chiave pubblica sulla boot partition (copiata dallo script Mac)
BOOT_PART=""
for candidate in /boot/firmware /boot; do
    if [[ -d "$candidate" ]]; then
        BOOT_PART="$candidate"
        break
    fi
done

if [[ -n "$BOOT_PART" ]]; then
    # Chiave copiata dal Mac script
    if [[ -f "${BOOT_PART}/authorized_keys" ]]; then
        info "Chiave pubblica trovata sulla partizione boot"
        
        # Aggiungi se non gia' presente
        PUBKEY=$(cat "${BOOT_PART}/authorized_keys")
        if ! grep -qF "$PUBKEY" "${MAIN_HOME}/.ssh/authorized_keys" 2>/dev/null; then
            echo "$PUBKEY" >> "${MAIN_HOME}/.ssh/authorized_keys"
            KEYS_ADDED=$((KEYS_ADDED + 1))
            log "Chiave aggiunta da boot partition"
        else
            log "Chiave gia' presente in authorized_keys"
        fi
    fi
    
    # Esegui lo script di setup SSH se presente
    if [[ -f "${BOOT_PART}/piclaw-ssh-setup.sh" ]]; then
        info "Esecuzione piclaw-ssh-setup.sh dalla boot partition..."
        bash "${BOOT_PART}/piclaw-ssh-setup.sh" 2>/dev/null || true
    fi
fi

# Permetti anche di aggiungere una chiave manualmente
if [[ $KEYS_ADDED -eq 0 ]]; then
    warn "Nessuna chiave trovata automaticamente."
    echo ""
    echo "  Puoi aggiungere la chiave del tuo Mac in due modi:"
    echo ""
    echo "  MODO 1 (dal Mac, in un altro terminale):"
    echo -e "    ${GREEN}ssh-copy-id ${MAIN_USER}@$(hostname).local${NC}"
    echo ""
    echo "  MODO 2 (incolla qui la chiave pubblica):"
    echo "    Copia dal Mac: cat ~/.ssh/id_ed25519.pub"
    echo ""
    
    if [[ -t 0 ]]; then
        read -p "  Vuoi incollare una chiave pubblica ora? (y/n): " ADD_KEY
        if [[ "$ADD_KEY" == "y" || "$ADD_KEY" == "Y" ]]; then
            echo "  Incolla la chiave pubblica e premi Invio:"
            read -r MANUAL_KEY
            if [[ -n "$MANUAL_KEY" ]]; then
                echo "$MANUAL_KEY" >> "${MAIN_HOME}/.ssh/authorized_keys"
                KEYS_ADDED=$((KEYS_ADDED + 1))
                log "Chiave aggiunta manualmente"
            fi
        fi
    fi
fi

# Fix permessi
chmod 600 "${MAIN_HOME}/.ssh/authorized_keys" 2>/dev/null || true
chown -R "${MAIN_USER}:${MAIN_USER}" "${MAIN_HOME}/.ssh"

TOTAL_KEYS=$(grep -c "^ssh-" "${MAIN_HOME}/.ssh/authorized_keys" 2>/dev/null || echo "0")
log "Chiavi SSH configurate: $TOTAL_KEYS"

# ─── Step 2: Hardening sshd_config ──────────────────────────────────────────
info "Step 2/5: Hardening configurazione SSH..."

SSHD_CONFIG="/etc/ssh/sshd_config"

# Backup originale
if [[ ! -f "${SSHD_CONFIG}.original" ]]; then
    cp "$SSHD_CONFIG" "${SSHD_CONFIG}.original"
    log "Backup sshd_config originale creato"
fi

# Crea configurazione PiClaw
cat > /etc/ssh/sshd_config.d/piclaw.conf << 'SSHD_PICLAW'
# ════════════════════════════════════════════════════════
# PiClaw SSH Hardening Configuration
# ════════════════════════════════════════════════════════

# ─── Autenticazione ─────────────────────────────────
# Abilita autenticazione con chiave pubblica
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys

# Password: abilitata per primo setup, disabilitare dopo
# Cambiare a "no" dopo aver verificato che la chiave funziona
PasswordAuthentication yes

# Disabilita metodi insicuri
ChallengeResponseAuthentication no
KerberosAuthentication no
GSSAPIAuthentication no

# ─── Accesso ────────────────────────────────────────
# Disabilita login root diretto (usa sudo)
PermitRootLogin no

# Solo utenti specifici possono connettersi
# Decommentare e adattare:
# AllowUsers pi openclaw

# Max tentativi login
MaxAuthTries 4
MaxSessions 5
LoginGraceTime 30

# ─── Sicurezza ──────────────────────────────────────
# Disabilita forwarding non necessario
X11Forwarding no
AllowTcpForwarding yes
AllowAgentForwarding yes
PermitTunnel no

# Protocollo
Protocol 2

# Banner pre-login
Banner /etc/ssh/banner

# Timeout sessioni inattive (5 min)
ClientAliveInterval 300
ClientAliveCountMax 3

# ─── Performance ────────────────────────────────────
# Compressione per connessioni lente
Compression yes

# Usa DNS solo se necessario
UseDNS no

# ─── Logging ────────────────────────────────────────
LogLevel VERBOSE
SyslogFacility AUTH
SSHD_PICLAW

log "Hardening SSH applicato"

# ─── Step 3: Banner SSH ─────────────────────────────────────────────────────
info "Step 3/5: Configurazione banner SSH..."

cat > /etc/ssh/banner << 'SSH_BANNER'

  ╔══════════════════════════════════════════════╗
  ║           🍓 PiClaw AI Agent                 ║
  ║        Raspberry Pi 4 - Sistema AI           ║
  ║                                              ║
  ║   Accesso autorizzato. Attivita' loggata.    ║
  ╚══════════════════════════════════════════════╝

SSH_BANNER

# MOTD personalizzato
cat > /etc/update-motd.d/10-piclaw << 'MOTD_SCRIPT'
#!/bin/bash
# PiClaw MOTD - Informazioni di sistema al login

echo ""
echo "  ══════════════════════════════════════════════"
echo "  PiClaw AI Agent - $(hostname)"
echo "  ══════════════════════════════════════════════"
echo ""

# Uptime
echo "  Uptime:      $(uptime -p)"

# CPU temp
TEMP=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo "0")
TEMP_C=$((TEMP / 1000))
echo "  Temperatura: ${TEMP_C}°C"

# RAM
MEM=$(free -m | awk 'NR==2{printf "%sMB / %sMB (%.0f%%)", $3, $2, $3*100/$2}')
echo "  RAM:         $MEM"

# Disco
DISK_ROOT=$(df -h / | awk 'NR==2{printf "%s / %s (%s)", $3, $2, $5}')
echo "  Disco (/):   $DISK_ROOT"
if mountpoint -q /data 2>/dev/null; then
    DISK_DATA=$(df -h /data | awk 'NR==2{printf "%s / %s (%s)", $3, $2, $5}')
    echo "  Disco /data: $DISK_DATA"
fi

# IP
IP_ETH=$(ip -4 addr show eth0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || echo "non connesso")
IP_WLAN=$(ip -4 addr show wlan0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || echo "non connesso")
echo "  Ethernet:    $IP_ETH"
echo "  WiFi:        $IP_WLAN"

# Servizi
OLLAMA_STATUS=$(systemctl is-active ollama 2>/dev/null || echo "non installato")
OPENCLAW_STATUS=$(systemctl is-active openclaw 2>/dev/null || echo "non installato")
echo ""
echo "  Servizi:"
echo "    Ollama:    $OLLAMA_STATUS"
echo "    OpenClaw:  $OPENCLAW_STATUS"

echo ""
echo "  ──────────────────────────────────────────────"
echo ""
MOTD_SCRIPT
chmod +x /etc/update-motd.d/10-piclaw

# Disabilita MOTD di default per evitare duplicati
chmod -x /etc/update-motd.d/10-uname 2>/dev/null || true

log "Banner e MOTD PiClaw configurati"

# ─── Step 4: Fail2ban per SSH ────────────────────────────────────────────────
info "Step 4/5: Configurazione fail2ban per SSH..."

# Installa fail2ban se non presente
if ! command -v fail2ban-server &>/dev/null; then
    apt-get install -y fail2ban
fi

# Configurazione fail2ban per SSH
cat > /etc/fail2ban/jail.d/piclaw-ssh.conf << 'FAIL2BAN'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
findtime = 600
bantime = 3600
ignoreip = 127.0.0.1/8 ::1 192.168.0.0/16 10.0.0.0/8
FAIL2BAN

systemctl enable fail2ban 2>/dev/null || true
systemctl restart fail2ban 2>/dev/null || true

log "fail2ban configurato: 5 tentativi, ban 1 ora"

# ─── Step 5: Applica configurazione ─────────────────────────────────────────
info "Step 5/5: Applicazione configurazione SSH..."

# Verifica sintassi sshd_config
if sshd -t 2>/dev/null; then
    log "Configurazione SSH valida"
    systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null
    log "Servizio SSH riavviato"
else
    err "Errore nella configurazione SSH!"
    err "Ripristino backup..."
    rm -f /etc/ssh/sshd_config.d/piclaw.conf
    systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null
    exit 1
fi

# ─── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  SSH CONFIGURATO${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""
log "Chiavi SSH: $TOTAL_KEYS configurate"
log "Hardening: applicato (no root login, max 4 tentativi)"
log "fail2ban: attivo (ban dopo 5 tentativi)"
log "Banner e MOTD: personalizzati PiClaw"
echo ""
echo "  Configurazione attuale:"
echo "    Porta:              $(grep -oP 'Port \K\d+' /etc/ssh/sshd_config 2>/dev/null || echo '22')"
echo "    Password auth:      $(grep -oP 'PasswordAuthentication \K\w+' /etc/ssh/sshd_config.d/piclaw.conf 2>/dev/null || echo 'yes')"
echo "    Pubkey auth:        $(grep -oP 'PubkeyAuthentication \K\w+' /etc/ssh/sshd_config.d/piclaw.conf 2>/dev/null || echo 'yes')"
echo "    Root login:         $(grep -oP 'PermitRootLogin \K\w+' /etc/ssh/sshd_config.d/piclaw.conf 2>/dev/null || echo 'no')"
echo ""
warn "IMPORTANTE: Non chiudere questa sessione SSH!"
warn "Apri un NUOVO terminale e verifica di poter riconnetterti:"
echo ""
echo -e "    ${GREEN}ssh ${MAIN_USER}@$(hostname).local${NC}"
echo -e "    ${GREEN}ssh piclaw${NC}  (se hai configurato ~/.ssh/config sul Mac)"
echo ""
warn "Se la connessione funziona, puoi disabilitare il login con password:"
echo -e "    ${BLUE}sudo sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config.d/piclaw.conf${NC}"
echo -e "    ${BLUE}sudo systemctl restart ssh${NC}"
echo ""
