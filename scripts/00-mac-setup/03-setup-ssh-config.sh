#!/usr/bin/env bash
###############################################################################
# 03-setup-ssh-config.sh
# Configura ~/.ssh/config sul Mac per accesso rapido al Pi.
# Dopo l'esecuzione: basta digitare "ssh piclaw" per connettersi.
#
# Uso:
#   bash scripts/00-mac-setup/03-setup-ssh-config.sh
#   bash scripts/00-mac-setup/03-setup-ssh-config.sh --ip 192.168.1.50
#   bash scripts/00-mac-setup/03-setup-ssh-config.sh --ip 192.168.1.88 --port 2222
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
PI_USER="pi"
PI_HOST="piclaw.local"
PI_PORT="2222"

while [[ $# -gt 0 ]]; do
    case $1 in
        --user|-u)  PI_USER="$2"; shift 2 ;;
        --ip|-i)    PI_HOST="$2"; shift 2 ;;
        --port|-p)  PI_PORT="$2"; shift 2 ;;
        --help|-h)
            echo "Uso: $0 [--user pi] [--ip piclaw.local] [--port 2222]"
            exit 0
            ;;
        *) shift ;;
    esac
done

echo ""
echo -e "${BOLD}  PiClaw - Setup SSH Config sul Mac${NC}"
echo ""

SSH_CONFIG="$HOME/.ssh/config"
SSH_DIR="$HOME/.ssh"

# Crea directory .ssh se non esiste
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"

# Cerca chiave SSH
SSH_KEY=""
for key_file in \
    "$SSH_DIR/id_ed25519" \
    "$SSH_DIR/id_rsa" \
    "$SSH_DIR/id_ecdsa"; do
    if [[ -f "$key_file" ]]; then
        SSH_KEY="$key_file"
        break
    fi
done

# Crea/aggiorna config
if [[ -f "$SSH_CONFIG" ]] && grep -q "Host piclaw" "$SSH_CONFIG"; then
    warn "Entry 'piclaw' gia' presente in $SSH_CONFIG"
    read -p "Vuoi sovrascriverla? (y/n): " OVERWRITE
    if [[ "$OVERWRITE" == "y" || "$OVERWRITE" == "Y" ]]; then
        # Rimuovi entry esistente (tra "Host piclaw" e il prossimo "Host " o fine file)
        # Usa un approccio sicuro con sed
        cp "$SSH_CONFIG" "${SSH_CONFIG}.bak"
        awk '/^Host piclaw/{found=1; next} /^Host /{found=0} !found' "${SSH_CONFIG}.bak" > "$SSH_CONFIG"
        log "Entry precedente rimossa (backup: ${SSH_CONFIG}.bak)"
    else
        info "Mantenuta configurazione esistente."
        echo ""
        info "Puoi connetterti con: ${GREEN}ssh piclaw${NC}"
        exit 0
    fi
fi

# Assicura newline alla fine del file
if [[ -f "$SSH_CONFIG" ]] && [[ -s "$SSH_CONFIG" ]]; then
    # Aggiungi newline se l'ultimo carattere non lo e'
    [[ "$(tail -c1 "$SSH_CONFIG" | wc -l)" -eq 0 ]] && echo "" >> "$SSH_CONFIG"
    echo "" >> "$SSH_CONFIG"
fi

# Scrivi configurazione
cat >> "$SSH_CONFIG" << SSH_ENTRY
# ─── PiClaw Raspberry Pi 4 ──────────────────────────
Host piclaw
    HostName ${PI_HOST}
    User ${PI_USER}
    Port ${PI_PORT}
    # Autenticazione
${SSH_KEY:+    IdentityFile ${SSH_KEY}}
    PreferredAuthentications publickey,password
    PubkeyAuthentication yes
    # Connessione stabile
    ServerAliveInterval 30
    ServerAliveCountMax 5
    TCPKeepAlive yes
    # Primo collegamento: accetta automaticamente la chiave host
    StrictHostKeyChecking accept-new
    # Multiplexing (connessioni multiple veloci)
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%r@%h-%p
    ControlPersist 600
    # Compressione (utile su WiFi)
    Compression yes
    # Forward agent (per git da Pi con le tue chiavi Mac)
    ForwardAgent yes

# Alias per SCP/SFTP rapido
Host piclaw-data
    HostName ${PI_HOST}
    User ${PI_USER}
    Port ${PI_PORT}
${SSH_KEY:+    IdentityFile ${SSH_KEY}}
    Compression yes
# ─────────────────────────────────────────────────────
SSH_ENTRY

# Crea directory per socket multiplexing
mkdir -p "$SSH_DIR/sockets"

chmod 600 "$SSH_CONFIG"

log "SSH config aggiornata: $SSH_CONFIG"
echo ""

# ─── Riepilogo ──────────────────────────────────────────────────────────────
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  SSH Configurato!${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""
echo "  Ora puoi connetterti al Pi semplicemente con:"
echo ""
echo -e "    ${GREEN}ssh piclaw${NC}"
echo ""
echo "  Comandi rapidi:"
echo -e "    ${BLUE}ssh piclaw${NC}                          # Connetti"
echo -e "    ${BLUE}ssh piclaw 'uptime'${NC}                 # Esegui comando"
echo -e "    ${BLUE}ssh piclaw 'sudo reboot'${NC}            # Riavvia il Pi"
echo -e "    ${BLUE}scp file.txt piclaw:~/${NC}              # Copia file sul Pi"
echo -e "    ${BLUE}scp piclaw:~/data.log ./${NC}            # Scarica file dal Pi"
echo -e "    ${BLUE}rsync -avz ./progetto piclaw:~/${NC}     # Sync cartella"
echo -e "    ${BLUE}sftp piclaw${NC}                         # File manager interattivo"
echo ""
echo "  Monitoraggio remoto:"
echo -e "    ${BLUE}ssh piclaw 'vcgencmd measure_temp'${NC}  # Temperatura"
echo -e "    ${BLUE}ssh piclaw 'free -h'${NC}                # Memoria"
echo -e "    ${BLUE}ssh piclaw 'df -h / /data'${NC}          # Disco"
echo -e "    ${BLUE}ssh piclaw 'htop'${NC}                   # Monitor interattivo"
echo ""
echo "  API PiClaw (con tunnel SSH):"
echo -e "    ${BLUE}ssh -L 3100:localhost:3100 -L 11434:localhost:11434 piclaw${NC}"
echo "    Poi apri nel browser: http://localhost:3100/health"
echo ""
