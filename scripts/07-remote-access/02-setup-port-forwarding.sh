#!/usr/bin/env bash
###############################################################################
# 02-setup-port-forwarding.sh
# Prepara il Pi per accesso remoto via Port Forwarding (senza servizi esterni).
#
# Questo script NON configura il router (devi farlo manualmente dal browser).
# Prepara il Pi con:
#   - Porta SSH custom (non 22, per sicurezza)
#   - fail2ban aggressivo
#   - DynDNS gratuito con DuckDNS (opzionale, per IP dinamico)
#
# Eseguire SUL PI: sudo bash scripts/07-remote-access/02-setup-port-forwarding.sh
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
echo -e "${BOLD}  PICLAW - Setup Port Forwarding (Accesso Senza VPN)${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""

# ─── Step 1: Porta SSH custom ───────────────────────────────────────────────
info "Step 1/4: Configurazione porta SSH custom..."
echo ""
echo "  Per sicurezza, quando esponi SSH su internet NON usare la porta 22."
echo "  Scegli un numero tra 10000 e 65535."
echo ""

SSH_PORT=2222
if [[ -t 0 ]]; then
    read -p "  Porta SSH (default 2222): " INPUT_PORT
    if [[ -n "$INPUT_PORT" ]] && [[ "$INPUT_PORT" =~ ^[0-9]+$ ]] && \
       [[ "$INPUT_PORT" -ge 1024 ]] && [[ "$INPUT_PORT" -le 65535 ]]; then
        SSH_PORT="$INPUT_PORT"
    fi
fi

# Configura sshd per ascoltare anche sulla porta custom
# Mantieni anche porta 22 per accesso locale
if ! grep -q "^Port $SSH_PORT" /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null; then
    cat > /etc/ssh/sshd_config.d/piclaw-port.conf << SSHD_PORT
# PiClaw: porta SSH custom per accesso remoto
# Porta 22 rimane per accesso dalla rete locale
Port 22
Port ${SSH_PORT}
SSHD_PORT
    log "SSH ascolta su porta 22 (locale) e $SSH_PORT (remoto)"
else
    log "Porta $SSH_PORT gia' configurata"
fi

# Verifica e restart SSH
sshd -t 2>/dev/null && systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null
log "SSH riavviato con porta $SSH_PORT"

# ─── Step 2: Hardening per esposizione internet ─────────────────────────────
info "Step 2/4: Hardening SSH per esposizione internet..."

cat > /etc/ssh/sshd_config.d/piclaw-hardening-remote.conf << 'SSHD_HARD'
# PiClaw: hardening aggiuntivo per accesso da internet
# Disabilita login con password (SOLO chiave pubblica)
PasswordAuthentication no
# Massimo 3 tentativi
MaxAuthTries 3
# Tempo login ridotto
LoginGraceTime 20
# No root login
PermitRootLogin no
# Solo protocollo 2
Protocol 2
SSHD_HARD

sshd -t 2>/dev/null && systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null
log "Hardening applicato: solo chiave SSH, no password, no root"
warn "IMPORTANTE: Assicurati che la tua chiave SSH sia gia' configurata!"
warn "Se non l'hai fatto: ssh-copy-id -p $SSH_PORT pi@$(hostname -I | awk '{print $1}')"

# ─── Step 3: fail2ban aggressivo ────────────────────────────────────────────
info "Step 3/4: Configurazione fail2ban aggressivo..."

apt-get install -y fail2ban 2>/dev/null || true

cat > /etc/fail2ban/jail.d/piclaw-remote.conf << FAIL2BAN
[sshd]
enabled = true
port = 22,${SSH_PORT}
filter = sshd
logpath = /var/log/auth.log
# Aggressivo: ban dopo 3 tentativi per 24 ore
maxretry = 3
findtime = 600
bantime = 86400
# Non bannare la rete locale
ignoreip = 127.0.0.1/8 ::1 192.168.0.0/16 10.0.0.0/8 172.16.0.0/12

[sshd-aggressive]
enabled = true
port = 22,${SSH_PORT}
filter = sshd[mode=aggressive]
logpath = /var/log/auth.log
# Recidivi: ban 7 giorni
maxretry = 2
findtime = 86400
bantime = 604800
FAIL2BAN

systemctl restart fail2ban 2>/dev/null || true
log "fail2ban: ban 24h dopo 3 tentativi, 7 giorni per recidivi"

# ─── Step 4: DuckDNS (DNS dinamico gratuito) ────────────────────────────────
info "Step 4/4: Configurazione DuckDNS (DNS dinamico)..."
echo ""
echo "  Il tuo IP pubblico di casa cambia periodicamente."
echo "  DuckDNS ti da' un nome fisso tipo: piclaw.duckdns.org"
echo "  Cosi' non devi cercare l'IP ogni volta."
echo ""
echo "  E' gratuito, senza account: vai su https://www.duckdns.org"
echo "  Fai login con Google/GitHub, crea un dominio (es. 'piclaw'),"
echo "  e copia il TOKEN che ti danno."
echo ""

SETUP_DUCKDNS="n"
DUCK_DOMAIN=""
DUCK_TOKEN=""

if [[ -t 0 ]]; then
    read -p "  Vuoi configurare DuckDNS? (y/n): " SETUP_DUCKDNS
fi

if [[ "$SETUP_DUCKDNS" == "y" || "$SETUP_DUCKDNS" == "Y" ]]; then
    read -p "  Nome dominio DuckDNS (es. 'piclaw'): " DUCK_DOMAIN
    read -p "  Token DuckDNS: " DUCK_TOKEN
    
    if [[ -n "$DUCK_DOMAIN" ]] && [[ -n "$DUCK_TOKEN" ]]; then
        # Crea script di aggiornamento
        mkdir -p /opt/duckdns
        cat > /opt/duckdns/duck.sh << DUCKDNS_SCRIPT
#!/bin/bash
# Aggiorna IP su DuckDNS
echo url="https://www.duckdns.org/update?domains=${DUCK_DOMAIN}&token=${DUCK_TOKEN}&ip=" | curl -k -o /opt/duckdns/duck.log -K -
DUCKDNS_SCRIPT
        chmod 700 /opt/duckdns/duck.sh
        
        # Cron job: aggiorna ogni 5 minuti
        echo "*/5 * * * * root /opt/duckdns/duck.sh >/dev/null 2>&1" > /etc/cron.d/duckdns
        
        # Esegui subito
        bash /opt/duckdns/duck.sh
        
        log "DuckDNS configurato: ${DUCK_DOMAIN}.duckdns.org"
        log "IP aggiornato ogni 5 minuti"
    fi
fi

# ─── Info IP pubblico attuale ────────────────────────────────────────────────
PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || curl -s --max-time 5 api.ipify.org 2>/dev/null || echo "non rilevabile")
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

# ─── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  PORT FORWARDING - CONFIGURAZIONE PI COMPLETATA${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""
log "Porta SSH: $SSH_PORT"
log "Hardening: solo chiave SSH, no password"
log "fail2ban: ban 24h dopo 3 tentativi"
if [[ -n "$DUCK_DOMAIN" ]]; then
    log "DuckDNS: ${DUCK_DOMAIN}.duckdns.org"
fi
echo ""
info "IP attuale:"
echo "  IP locale Pi:   $LOCAL_IP"
echo "  IP pubblico:    $PUBLIC_IP"
echo ""
echo -e "${BOLD}  ORA DEVI CONFIGURARE IL ROUTER (manualmente):${NC}"
echo ""
echo "  1. Apri il browser e vai all'indirizzo del router:"
echo -e "     ${BLUE}http://192.168.1.1${NC}  (o http://192.168.0.1)"
echo "     Credenziali: di solito scritte sotto il router"
echo ""
echo "  2. Cerca la sezione:"
echo "     'Port Forwarding' / 'Virtual Server' / 'NAT' / 'Inoltro porte'"
echo ""
echo "  3. Aggiungi questa regola:"
echo "     ┌────────────────────────────────────────────┐"
echo "     │ Porta esterna: ${SSH_PORT}                          │"
echo "     │ Porta interna: ${SSH_PORT}                          │"
echo "     │ IP interno:    ${LOCAL_IP}$(printf '%*s' $((20 - ${#LOCAL_IP})) '')│"
echo "     │ Protocollo:    TCP                         │"
echo "     └────────────────────────────────────────────┘"
echo ""
echo "  4. Salva e applica."
echo ""
echo -e "${BOLD}  DAL MAC (da qualsiasi rete):${NC}"
echo ""
if [[ -n "$DUCK_DOMAIN" ]]; then
    echo -e "     ${GREEN}ssh -p ${SSH_PORT} pi@${DUCK_DOMAIN}.duckdns.org${NC}"
    echo ""
    echo "     Oppure con IP diretto:"
fi
echo -e "     ${GREEN}ssh -p ${SSH_PORT} pi@${PUBLIC_IP}${NC}"
echo ""
echo -e "  ${BOLD}Aggiungi al ~/.ssh/config del Mac:${NC}"
echo ""
echo "     Host piclaw-remote"
echo "         HostName ${DUCK_DOMAIN:+${DUCK_DOMAIN}.duckdns.org}${DUCK_DOMAIN:-${PUBLIC_IP}}"
echo "         User pi"
echo "         Port ${SSH_PORT}"
echo "         ServerAliveInterval 30"
echo "         Compression yes"
echo ""
echo "  Poi basta: ${GREEN}ssh piclaw-remote${NC}"
echo ""
