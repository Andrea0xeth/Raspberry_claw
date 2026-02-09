#!/usr/bin/env bash
###############################################################################
# 01-install-nordvpn-meshnet.sh
# Installa NordVPN + Meshnet sul Raspberry Pi per accesso SSH remoto.
#
# Meshnet e' incluso nell'abbonamento NordVPN: collega i tuoi dispositivi
# tra loro con IP privati, come se fossero sulla stessa rete.
# Non serve aprire porte sul router.
#
# Eseguire SUL PI: sudo bash scripts/07-remote-access/01-install-nordvpn-meshnet.sh
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
echo -e "${BOLD}  PICLAW - Installazione NordVPN Meshnet${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""

# ─── Step 1: Installazione NordVPN ──────────────────────────────────────────
info "Step 1/5: Installazione NordVPN..."

if command -v nordvpn &>/dev/null; then
    NORD_VER=$(nordvpn version 2>/dev/null || echo "installato")
    log "NordVPN gia' installato: $NORD_VER"
else
    info "Download e installazione NordVPN per Linux ARM64..."
    
    # Installazione ufficiale NordVPN per Debian/Raspberry Pi
    # Aggiungi repository e chiave GPG
    sh <(curl -sSf https://downloads.nordcdn.com/apps/linux/install.sh)
    
    if command -v nordvpn &>/dev/null; then
        log "NordVPN installato: $(nordvpn version 2>/dev/null)"
    else
        err "Installazione NordVPN fallita."
        err "Prova manualmente: https://support.nordvpn.com/hc/en-us/articles/20196094470929"
        exit 1
    fi
fi

# ─── Step 2: Abilitazione servizio ──────────────────────────────────────────
info "Step 2/5: Abilitazione servizio NordVPN..."

systemctl enable --now nordvpnd 2>/dev/null || true
sleep 2

# Aggiungi utente al gruppo nordvpn
MAIN_USER=$(ls /home/ | head -1)
if [[ -n "$MAIN_USER" ]]; then
    usermod -aG nordvpn "$MAIN_USER" 2>/dev/null || true
    log "Utente '$MAIN_USER' aggiunto al gruppo nordvpn"
fi
# Anche per l'utente openclaw
usermod -aG nordvpn openclaw 2>/dev/null || true

log "Servizio NordVPN attivo"

# ─── Step 3: Login ──────────────────────────────────────────────────────────
info "Step 3/5: Login NordVPN..."
echo ""

# Controlla se gia' loggato
if nordvpn account 2>/dev/null | grep -q "Email"; then
    ACCOUNT=$(nordvpn account 2>/dev/null | grep "Email" | awk '{print $NF}')
    log "Gia' loggato come: $ACCOUNT"
else
    echo -e "  Devi fare login con il tuo account NordVPN."
    echo ""
    echo -e "  ${BOLD}Metodo 1 (consigliato):${NC}"
    echo -e "  Esegui questo comando e segui il link che appare:"
    echo ""
    echo -e "    ${GREEN}nordvpn login${NC}"
    echo ""
    echo -e "  Ti dara' un link tipo:"
    echo -e "  https://api.nordvpn.com/v1/users/oauth/login-redirect?..."
    echo -e "  Copialo, aprilo nel browser del Mac, fai login."
    echo ""
    echo -e "  ${BOLD}Metodo 2 (con token):${NC}"
    echo -e "  Vai su https://my.nordaccount.com/dashboard/nordvpn/"
    echo -e "  Genera un Access Token, poi:"
    echo -e "    ${GREEN}nordvpn login --token IL_TUO_TOKEN${NC}"
    echo ""
    
    # Tenta login interattivo
    nordvpn login || {
        warn "Login non completato. Eseguilo manualmente dopo:"
        warn "  nordvpn login"
        warn "  Poi riesegui questo script."
    }
    
    # Verifica
    if nordvpn account 2>/dev/null | grep -q "Email"; then
        ACCOUNT=$(nordvpn account 2>/dev/null | grep "Email" | awk '{print $NF}')
        log "Login riuscito: $ACCOUNT"
    else
        warn "Login non ancora completato. Continuo setup, dovrai"
        warn "fare login manualmente dopo con: nordvpn login"
    fi
fi

# ─── Step 4: Abilita Meshnet ────────────────────────────────────────────────
info "Step 4/5: Abilitazione Meshnet..."

# Abilita Meshnet
nordvpn set meshnet on 2>/dev/null || {
    warn "Meshnet non attivabile ora (forse login non completato)"
    warn "Dopo il login, esegui: nordvpn set meshnet on"
}

# Configura impostazioni ottimali per accesso remoto
nordvpn set lan-discovery on 2>/dev/null || true   # Scopri dispositivi LAN
nordvpn set autoconnect off 2>/dev/null || true     # Non connettere VPN auto
nordvpn set firewall off 2>/dev/null || true        # Non bloccare connessioni locali
nordvpn set dns off 2>/dev/null || true             # Usa DNS locale

log "Meshnet abilitato"

# ─── Step 5: Permessi Meshnet per SSH ────────────────────────────────────────
info "Step 5/5: Configurazione permessi Meshnet..."

# Permetti accesso remoto e routing dal tuo Mac
# (si applica a tutti i dispositivi del tuo account)
nordvpn meshnet peer list 2>/dev/null || true

# Abilita permessi per tutti i peer (i tuoi dispositivi)
# I peer con lo stesso account NordVPN sono automaticamente fidati
nordvpn meshnet peer incoming allow 2>/dev/null || true
nordvpn meshnet peer routing allow 2>/dev/null || true

log "Permessi Meshnet configurati"

# ─── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  NORDVPN MESHNET CONFIGURATO${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""

# Mostra info Meshnet
MESHNET_IP=$(nordvpn meshnet peer list 2>/dev/null | grep "$(hostname)" | awk '{print $2}' || echo "in attesa...")
MESHNET_HOSTNAME=$(hostname)

info "Info Meshnet del Pi:"
echo ""
nordvpn meshnet peer list 2>/dev/null || echo "  (eseguire nordvpn login prima)"
echo ""

echo -e "${BOLD}  SETUP SUL MAC:${NC}"
echo ""
echo "  1. Apri NordVPN sul Mac (l'app che usi gia')"
echo "  2. Vai in Impostazioni → Meshnet → Attiva Meshnet"
echo "     Oppure da terminale (se hai NordVPN CLI per Mac):"
echo -e "     ${GREEN}nordvpn set meshnet on${NC}"
echo ""
echo "  3. Nella sezione Meshnet, vedrai il Pi nella lista dispositivi."
echo "     Ogni dispositivo ha un nome tipo:"
echo -e "     ${BLUE}${MESHNET_HOSTNAME}.nord${NC}"
echo "     e un IP Meshnet (es. 10.5.x.x)"
echo ""
echo "  4. Dal terminale Mac, connettiti con:"
echo ""
echo -e "     ${GREEN}ssh pi@${MESHNET_HOSTNAME}.nord${NC}"
echo ""
echo "     Oppure trova l'IP Meshnet del Pi e usa quello:"
echo -e "     ${GREEN}ssh pi@<IP-MESHNET-DEL-PI>${NC}"
echo ""
echo "     Per trovare l'IP Meshnet del Pi:"
echo -e "     ${BLUE}nordvpn meshnet peer list${NC}  (dal Mac o dal Pi)"
echo ""
echo -e "${BOLD}  COMANDI UTILI (sul Pi):${NC}"
echo -e "    ${BLUE}nordvpn meshnet peer list${NC}          # Lista dispositivi Meshnet"
echo -e "    ${BLUE}nordvpn account${NC}                    # Info account"
echo -e "    ${BLUE}nordvpn settings${NC}                   # Impostazioni attuali"
echo -e "    ${BLUE}nordvpn set meshnet on${NC}             # Riattiva Meshnet"
echo -e "    ${BLUE}nordvpn set meshnet off${NC}            # Disattiva Meshnet"
echo ""
echo -e "${BOLD}  NOTA:${NC} Meshnet funziona SENZA che la VPN sia connessa a un server."
echo "  E' un collegamento diretto tra i tuoi dispositivi."
echo "  La VPN (connessione a server NordVPN) e' separata e non serve per SSH."
echo ""
