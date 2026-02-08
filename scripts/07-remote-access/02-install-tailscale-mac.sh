#!/usr/bin/env bash
###############################################################################
# 02-install-tailscale-mac.sh
# Installa e configura Tailscale sul Mac per accesso remoto al Pi.
#
# Eseguire SUL MAC: bash scripts/07-remote-access/02-install-tailscale-mac.sh
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

echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  PICLAW - Installazione Tailscale sul Mac${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""

# ─── Metodo 1: Homebrew (preferito) ─────────────────────────────────────────
if command -v brew &>/dev/null; then
    info "Installazione via Homebrew..."
    
    if brew list --cask tailscale &>/dev/null 2>&1; then
        log "Tailscale gia' installato via Homebrew"
    else
        brew install --cask tailscale
        log "Tailscale installato via Homebrew"
    fi
else
    # ─── Metodo 2: Download diretto ─────────────────────────────────────────
    warn "Homebrew non trovato."
    echo ""
    info "Installa Tailscale dal Mac App Store o dal sito:"
    echo ""
    echo "  Mac App Store:"
    echo "    https://apps.apple.com/app/tailscale/id1475387142"
    echo ""
    echo "  Download diretto:"
    echo "    https://tailscale.com/download/mac"
    echo ""
    read -p "Premi Invio dopo aver installato Tailscale..." _
fi

# ─── Verifica installazione ──────────────────────────────────────────────────
echo ""
if command -v tailscale &>/dev/null; then
    info "Tailscale CLI trovato: $(tailscale version 2>/dev/null | head -1)"
elif [[ -d "/Applications/Tailscale.app" ]]; then
    info "Tailscale.app trovato. Aprilo dalla barra dei menu per fare login."
else
    warn "Tailscale non rilevato. Assicurati di averlo installato e aperto."
fi

# ─── Configurazione SSH ─────────────────────────────────────────────────────
info "Configurazione SSH per Tailscale..."

SSH_CONFIG="$HOME/.ssh/config"
mkdir -p "$HOME/.ssh"

# Aggiungi entry per Pi via Tailscale
if grep -q "Host piclaw-remote" "$SSH_CONFIG" 2>/dev/null; then
    log "Entry 'piclaw-remote' gia' presente in SSH config"
else
    # Aggiungi newline se file esiste e non finisce con newline
    if [[ -f "$SSH_CONFIG" ]] && [[ -s "$SSH_CONFIG" ]]; then
        [[ "$(tail -c1 "$SSH_CONFIG" | wc -l)" -eq 0 ]] && echo "" >> "$SSH_CONFIG"
        echo "" >> "$SSH_CONFIG"
    fi
    
    cat >> "$SSH_CONFIG" << 'SSH_TAILSCALE'
# ─── PiClaw via Tailscale (accesso da qualsiasi rete) ───
Host piclaw-remote
    HostName piclaw
    User pi
    # Tailscale SSH non richiede chiave/password
    # Il tunnel e' gia' criptato e autenticato
    ServerAliveInterval 30
    ServerAliveCountMax 5
    Compression yes
    ForwardAgent yes
# ─────────────────────────────────────────────────────────
SSH_TAILSCALE

    chmod 600 "$SSH_CONFIG"
    log "SSH config aggiornata con entry 'piclaw-remote'"
fi

# ─── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  SETUP MAC COMPLETATO${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""
echo "  1. Apri Tailscale (icona nella barra dei menu del Mac)"
echo "  2. Fai login con lo STESSO account usato sul Pi"
echo ""
echo "  Poi connettiti al Pi da qualsiasi rete:"
echo ""
echo -e "     ${GREEN}ssh piclaw-remote${NC}           # Da qualsiasi rete nel mondo"
echo -e "     ${GREEN}ssh piclaw${NC}                  # Solo se sei sulla stessa LAN"
echo ""
echo "  Entrambi funzionano. Usa 'piclaw-remote' quando sei fuori casa."
echo ""
echo -e "  ${BLUE}Verifica dispositivi connessi:${NC}"
echo -e "     ${GREEN}tailscale status${NC}"
echo ""
echo -e "  ${BLUE}Test connessione al Pi:${NC}"
echo -e "     ${GREEN}tailscale ping piclaw${NC}"
echo ""
