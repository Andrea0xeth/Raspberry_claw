#!/usr/bin/env bash
###############################################################################
# 02-connect-ssh.sh
# Helper per connettersi al Raspberry Pi via SSH dal Mac.
# Cerca automaticamente il Pi sulla rete locale e si connette.
#
# Uso:
#   bash scripts/00-mac-setup/02-connect-ssh.sh
#   bash scripts/00-mac-setup/02-connect-ssh.sh --user pi
#   bash scripts/00-mac-setup/02-connect-ssh.sh --ip 192.168.1.100
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

# ─── Parametri ──────────────────────────────────────────────────────────────
PI_USER="${PI_USER:-pi}"
PI_HOST=""
PI_PORT="${PI_PORT:-22}"
SSH_KEY=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --user|-u)  PI_USER="$2"; shift 2 ;;
        --ip|-i)    PI_HOST="$2"; shift 2 ;;
        --port|-p)  PI_PORT="$2"; shift 2 ;;
        --key|-k)   SSH_KEY="$2"; shift 2 ;;
        --help|-h)
            echo "Uso: $0 [opzioni]"
            echo ""
            echo "Opzioni:"
            echo "  --user, -u USER    Utente SSH (default: pi)"
            echo "  --ip, -i IP        IP del Pi (auto-discovery se omesso)"
            echo "  --port, -p PORT    Porta SSH (default: 22)"
            echo "  --key, -k PATH     Percorso chiave privata SSH"
            echo "  --help, -h         Mostra questo help"
            exit 0
            ;;
        *)
            PI_HOST="$1"; shift ;;
    esac
done

echo ""
echo -e "${BOLD}  PiClaw - Connessione SSH al Raspberry Pi${NC}"
echo ""

# ─── Trova chiave SSH ───────────────────────────────────────────────────────
if [[ -z "$SSH_KEY" ]]; then
    for key_file in \
        "$HOME/.ssh/id_ed25519" \
        "$HOME/.ssh/id_rsa" \
        "$HOME/.ssh/id_ecdsa"; do
        if [[ -f "$key_file" ]]; then
            SSH_KEY="$key_file"
            break
        fi
    done
fi

# ─── Discovery del Pi ───────────────────────────────────────────────────────
if [[ -z "$PI_HOST" ]]; then
    info "Ricerca Raspberry Pi sulla rete locale..."
    echo ""
    
    # Metodo 1: mDNS / Bonjour (piu' affidabile su Mac)
    info "Tentativo 1: mDNS (piclaw.local)..."
    if ping -c 1 -W 2 piclaw.local &>/dev/null; then
        PI_HOST="piclaw.local"
        log "Pi trovato via mDNS: $PI_HOST"
    else
        info "  piclaw.local non risponde, provo raspberrypi.local..."
        if ping -c 1 -W 2 raspberrypi.local &>/dev/null; then
            PI_HOST="raspberrypi.local"
            log "Pi trovato via mDNS: $PI_HOST"
        fi
    fi
    
    # Metodo 2: ARP table (cerca MAC address Raspberry Pi)
    if [[ -z "$PI_HOST" ]]; then
        info "Tentativo 2: Ricerca via MAC address..."
        # MAC prefix dei Raspberry Pi: b8:27:eb, dc:a6:32, d8:3a:dd, e4:5f:01, 2c:cf:67
        PI_IP=$(arp -a 2>/dev/null | grep -iE 'b8:27:eb|dc:a6:32|d8:3a:dd|e4:5f:01|2c:cf:67' | \
                grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)
        if [[ -n "$PI_IP" ]]; then
            PI_HOST="$PI_IP"
            log "Pi trovato via ARP: $PI_HOST"
        fi
    fi
    
    # Metodo 3: dns-sd (Bonjour browse)
    if [[ -z "$PI_HOST" ]]; then
        info "Tentativo 3: Bonjour service discovery..."
        # Cerca servizi SSH sulla rete locale (timeout 3 secondi)
        BONJOUR_RESULT=$(timeout 3 dns-sd -B _ssh._tcp local 2>/dev/null | grep -i "piclaw\|raspberry" | head -1 || true)
        if [[ -n "$BONJOUR_RESULT" ]]; then
            PI_HOSTNAME=$(echo "$BONJOUR_RESULT" | awk '{print $NF}')
            PI_HOST="${PI_HOSTNAME}.local"
            log "Pi trovato via Bonjour: $PI_HOST"
        fi
    fi
    
    # Metodo 4: Scansione rete (ultimo resort)
    if [[ -z "$PI_HOST" ]]; then
        info "Tentativo 4: Scansione porta 22 sulla rete locale..."
        
        # Trova subnet locale
        LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
        if [[ -n "$LOCAL_IP" ]]; then
            SUBNET=$(echo "$LOCAL_IP" | sed 's/\.[0-9]*$/./')
            info "  Scansione ${SUBNET}0/24 (porta 22)..."
            
            for i in $(seq 1 254); do
                IP="${SUBNET}${i}"
                # Ping veloce + check porta 22
                if (echo >/dev/tcp/"$IP"/22) 2>/dev/null; then
                    # Verifica se e' un Pi via SSH banner
                    BANNER=$(timeout 2 bash -c "echo '' | nc -w1 $IP 22 2>/dev/null" || true)
                    if echo "$BANNER" | grep -qi "ssh\|openssh"; then
                        echo -e "    Trovato SSH su: ${GREEN}${IP}${NC}"
                        PI_HOST="$IP"
                        # Non fermarti al primo, mostra tutti
                    fi
                fi
            done &
            # Aspetta max 10 secondi
            sleep 10
            kill %1 2>/dev/null || true
            wait 2>/dev/null || true
        fi
    fi
    
    # Se ancora non trovato
    if [[ -z "$PI_HOST" ]]; then
        echo ""
        err "Raspberry Pi non trovato automaticamente!"
        echo ""
        info "Verifica che:"
        info "  1. Il Pi sia acceso e collegato alla stessa rete"
        info "  2. SSH sia abilitato (file 'ssh' nella partizione boot)"
        info "  3. Il Pi abbia finito il primo boot (attendi 2 min)"
        echo ""
        info "Trova l'IP manualmente:"
        info "  - Controlla il router (pagina DHCP clients)"
        info "  - Collega monitor+tastiera al Pi e digita: hostname -I"
        echo ""
        read -p "Inserisci IP del Pi manualmente: " PI_HOST
        if [[ -z "$PI_HOST" ]]; then
            err "Nessun IP fornito. Uscita."
            exit 1
        fi
    fi
fi

# ─── Test connessione ───────────────────────────────────────────────────────
echo ""
info "Test connessione a $PI_HOST:$PI_PORT..."

if ! ping -c 1 -W 3 "$PI_HOST" &>/dev/null; then
    warn "Ping fallito, ma SSH potrebbe comunque funzionare..."
fi

# ─── Connessione SSH ────────────────────────────────────────────────────────
echo ""
log "Connessione a ${PI_USER}@${PI_HOST}:${PI_PORT}"
echo ""
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo -e "${BOLD}  Sessione SSH al Raspberry Pi${NC}"
echo -e "${BOLD}  Ctrl+D o 'exit' per disconnettersi${NC}"
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo ""

# Costruisci comando SSH
SSH_CMD="ssh"
SSH_OPTS="-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30"

if [[ -n "$SSH_KEY" ]]; then
    SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
fi

if [[ "$PI_PORT" != "22" ]]; then
    SSH_OPTS="$SSH_OPTS -p $PI_PORT"
fi

# Connetti
exec $SSH_CMD $SSH_OPTS "${PI_USER}@${PI_HOST}"
