#!/usr/bin/env bash
###############################################################################
# 01-install-tailscale.sh
# Installa Tailscale sul Raspberry Pi per accesso SSH da qualsiasi rete.
#
# Tailscale crea una VPN personale gratuita: il Mac e il Pi si vedono
# come se fossero sulla stessa rete, anche se sono su reti diverse
# (es. tu al lavoro, Pi a casa).
#
# Eseguire SUL PI: sudo bash scripts/07-remote-access/01-install-tailscale.sh
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
echo -e "${BOLD}  PICLAW - Installazione Tailscale (Accesso Remoto)${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""

# ─── Step 1: Installazione ──────────────────────────────────────────────────
info "Step 1/4: Installazione Tailscale..."

if command -v tailscale &>/dev/null; then
    log "Tailscale gia' installato: $(tailscale version 2>/dev/null | head -1)"
else
    # Installazione ufficiale per Raspberry Pi OS / Debian
    curl -fsSL https://tailscale.com/install.sh | sh
    log "Tailscale installato"
fi

# ─── Step 2: Abilitazione servizio ──────────────────────────────────────────
info "Step 2/4: Abilitazione servizio..."

systemctl enable --now tailscaled
log "Servizio tailscaled attivo"

# ─── Step 3: Configurazione ─────────────────────────────────────────────────
info "Step 3/4: Configurazione Tailscale..."

# Abilita SSH via Tailscale e accetta DNS
tailscale up --ssh --accept-dns=true --hostname=piclaw

echo ""
log "Tailscale configurato!"
echo ""

# ─── Step 4: Verifica ───────────────────────────────────────────────────────
info "Step 4/4: Verifica connessione..."

TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "in attesa di login...")
TAILSCALE_STATUS=$(tailscale status --json 2>/dev/null | jq -r '.Self.Online' 2>/dev/null || echo "unknown")

echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  TAILSCALE INSTALLATO${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""
log "IP Tailscale del Pi: ${TAILSCALE_IP}"
log "Stato: ${TAILSCALE_STATUS}"
echo ""
echo -e "${BOLD}  PROSSIMI PASSI:${NC}"
echo ""
echo "  1. Se ti ha aperto un link di login nel terminale,"
echo "     copialo e aprilo nel browser del Mac per autorizzare."
echo ""
echo "  2. Sul MAC, installa Tailscale:"
echo "     - Scarica da: https://tailscale.com/download/mac"
echo "     - Oppure: brew install tailscale"
echo "     - Apri Tailscale, fai login con lo STESSO account"
echo ""
echo "  3. Dopo che entrambi sono connessi, dal Mac:"
echo ""
echo -e "     ${GREEN}ssh pi@piclaw${NC}"
echo "     (Tailscale SSH integrato, non serve nemmeno la porta 22)"
echo ""
echo "     Oppure con l'IP Tailscale:"
echo -e "     ${GREEN}ssh pi@${TAILSCALE_IP}${NC}"
echo ""
echo "  Funziona da QUALSIASI rete: casa, ufficio, 4G, hotel..."
echo ""
echo -e "  Comandi utili:"
echo -e "    ${BLUE}tailscale status${NC}          # Stato e dispositivi connessi"
echo -e "    ${BLUE}tailscale ip${NC}              # Il tuo IP Tailscale"
echo -e "    ${BLUE}tailscale ping piclaw${NC}     # Test connessione dal Mac"
echo -e "    ${BLUE}sudo tailscale down${NC}       # Disconnetti (temporaneo)"
echo -e "    ${BLUE}sudo tailscale up --ssh${NC}   # Riconnetti"
echo ""
