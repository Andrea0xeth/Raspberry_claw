#!/usr/bin/env bash
###############################################################################
# 01-prepare-sd-mac.sh
# Prepara la microSD su Mac per primo boot headless con SSH abilitato.
#
# Eseguire sul MAC (NON sul Pi) dopo aver flashato l'OS con RPi Imager:
#   bash scripts/00-mac-setup/01-prepare-sd-mac.sh
#
# Cosa fa:
#   1. Rileva automaticamente la microSD montata (/Volumes/bootfs)
#   2. Abilita SSH al primo boot
#   3. Copia la tua chiave pubblica SSH (~/.ssh/id_*.pub) per login senza password
#   4. Configura WiFi (opzionale) per connessione headless
#   5. Crea file di configurazione per hostname e locale
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
echo -e "${BOLD}  PICLAW - Preparazione microSD da Mac${NC}"
echo -e "${BOLD}  Eseguire DOPO aver flashato con Raspberry Pi Imager${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""

# ─── Step 1: Rileva partizione boot della microSD ───────────────────────────
info "Step 1/5: Rilevamento microSD..."

BOOT_VOL=""

# Cerca i volumi boot tipici di RPi OS
for candidate in /Volumes/bootfs /Volumes/boot /Volumes/BOOT; do
    if [[ -d "$candidate" ]] && [[ -f "$candidate/config.txt" || -f "$candidate/cmdline.txt" ]]; then
        BOOT_VOL="$candidate"
        break
    fi
done

# Se non trovato, cerca qualsiasi volume con config.txt
if [[ -z "$BOOT_VOL" ]]; then
    for vol in /Volumes/*; do
        if [[ -d "$vol" ]] && [[ -f "$vol/config.txt" ]]; then
            BOOT_VOL="$vol"
            break
        fi
    done
fi

if [[ -z "$BOOT_VOL" ]]; then
    err "microSD non trovata!"
    echo ""
    info "Assicurati di aver:"
    info "  1. Flashato Raspberry Pi OS con RPi Imager"
    info "  2. Reinserito la microSD nel Mac"
    info "  3. Atteso che il Finder la monti"
    echo ""
    info "Volumi disponibili:"
    ls /Volumes/ 2>/dev/null
    echo ""
    
    # Chiedi percorso manuale
    read -p "Inserisci percorso boot volume manualmente (es. /Volumes/bootfs): " BOOT_VOL
    if [[ ! -d "$BOOT_VOL" ]]; then
        err "Percorso non valido: $BOOT_VOL"
        exit 1
    fi
fi

log "microSD trovata: $BOOT_VOL"

# ─── Step 2: Abilita SSH ────────────────────────────────────────────────────
info "Step 2/5: Abilitazione SSH al primo boot..."

# Crea file 'ssh' vuoto nella partizione boot
# Questo fa si' che RPi OS abiliti SSH automaticamente al primo avvio
touch "${BOOT_VOL}/ssh"
log "SSH abilitato (file ${BOOT_VOL}/ssh creato)"

# ─── Step 3: Copia chiave pubblica SSH ──────────────────────────────────────
info "Step 3/5: Configurazione autenticazione SSH con chiave pubblica..."

SSH_KEY=""

# Cerca chiavi SSH esistenti sul Mac, in ordine di preferenza
for key_file in \
    "$HOME/.ssh/id_ed25519.pub" \
    "$HOME/.ssh/id_rsa.pub" \
    "$HOME/.ssh/id_ecdsa.pub"; do
    if [[ -f "$key_file" ]]; then
        SSH_KEY="$key_file"
        break
    fi
done

if [[ -z "$SSH_KEY" ]]; then
    warn "Nessuna chiave SSH trovata in ~/.ssh/"
    echo ""
    read -p "Vuoi generare una nuova chiave SSH ed25519? (y/n): " GEN_KEY
    if [[ "$GEN_KEY" == "y" || "$GEN_KEY" == "Y" ]]; then
        ssh-keygen -t ed25519 -C "piclaw@$(hostname)" -f "$HOME/.ssh/id_ed25519" -N ""
        SSH_KEY="$HOME/.ssh/id_ed25519.pub"
        log "Nuova chiave SSH generata: $SSH_KEY"
    else
        warn "Saltata configurazione chiave SSH."
        warn "Dovrai usare password per il primo accesso."
    fi
fi

if [[ -n "$SSH_KEY" ]]; then
    PUBKEY_CONTENT=$(cat "$SSH_KEY")
    KEY_TYPE=$(echo "$PUBKEY_CONTENT" | awk '{print $1}')
    KEY_COMMENT=$(echo "$PUBKEY_CONTENT" | awk '{print $3}')
    
    log "Chiave trovata: $KEY_TYPE ($KEY_COMMENT)"
    
    # RPi Imager crea un file userconf.txt per l'utente
    # Ma per le chiavi SSH usiamo il metodo custom-firstrun
    # Creiamo uno script firstrun che configura le chiavi
    
    # Verifica se c'e' gia' una directory di pre-configurazione
    # Su RPi OS Bookworm, usiamo custom.toml se presente
    if [[ -f "${BOOT_VOL}/custom.toml" ]]; then
        # Aggiungi chiave al custom.toml esistente
        warn "custom.toml presente (Imager avanzato). Chiave verra' configurata via firstrun."
    fi
    
    # Metodo universale: creiamo firstrun.sh che verra' eseguito dopo il boot
    # e uno script di setup SSH nella partizione boot
    cat > "${BOOT_VOL}/piclaw-ssh-setup.sh" << FIRSTRUN_SSH
#!/bin/bash
# PiClaw SSH Key Setup - Eseguito manualmente dopo primo boot
# Uso: sudo bash /boot/firmware/piclaw-ssh-setup.sh

# Determina l'utente principale (pi o quello creato da Imager)
MAIN_USER=\$(ls /home/ | head -1)
if [[ -z "\$MAIN_USER" ]]; then
    MAIN_USER="pi"
fi

HOME_DIR="/home/\$MAIN_USER"

# Crea directory .ssh
mkdir -p "\$HOME_DIR/.ssh"
chmod 700 "\$HOME_DIR/.ssh"

# Aggiungi chiave pubblica
echo "${PUBKEY_CONTENT}" >> "\$HOME_DIR/.ssh/authorized_keys"
chmod 600 "\$HOME_DIR/.ssh/authorized_keys"

# Fix ownership
chown -R "\$MAIN_USER:\$MAIN_USER" "\$HOME_DIR/.ssh"

# Configura sshd per accettare chiavi
sed -i 's/#PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/#AuthorizedKeysFile.*/AuthorizedKeysFile .ssh\/authorized_keys/' /etc/ssh/sshd_config

# Restart SSH
systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null

echo "SSH configurato per \$MAIN_USER con chiave pubblica"
echo "Puoi ora connetterti senza password: ssh \$MAIN_USER@\$(hostname).local"
FIRSTRUN_SSH
    
    chmod +x "${BOOT_VOL}/piclaw-ssh-setup.sh"
    log "Script SSH key setup copiato su microSD"
    
    # Salva anche la chiave pubblica direttamente sulla boot partition
    # per poterla usare manualmente se necessario
    cp "$SSH_KEY" "${BOOT_VOL}/authorized_keys"
    log "Chiave pubblica copiata: ${BOOT_VOL}/authorized_keys"
fi

# ─── Step 4: Configurazione WiFi (opzionale) ────────────────────────────────
info "Step 4/5: Configurazione WiFi..."
echo ""
read -p "Vuoi configurare il WiFi per connessione headless? (y/n): " SETUP_WIFI

if [[ "$SETUP_WIFI" == "y" || "$SETUP_WIFI" == "Y" ]]; then
    read -p "  SSID della rete WiFi: " WIFI_SSID
    read -s -p "  Password WiFi: " WIFI_PASS
    echo ""
    read -p "  Paese WiFi (default IT): " WIFI_COUNTRY
    WIFI_COUNTRY=${WIFI_COUNTRY:-IT}
    
    # Per RPi OS Bookworm, il WiFi si configura via NetworkManager
    # Creiamo il file di configurazione wpa_supplicant per compatibilita'
    cat > "${BOOT_VOL}/wpa_supplicant.conf" << WIFI_CONF
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=${WIFI_COUNTRY}

network={
    ssid="${WIFI_SSID}"
    psk="${WIFI_PASS}"
    key_mgmt=WPA-PSK
    priority=1
}
WIFI_CONF
    
    log "WiFi configurato: SSID='${WIFI_SSID}', Country=${WIFI_COUNTRY}"
    
    # Per Bookworm con NetworkManager, creiamo anche il profilo NM
    mkdir -p "${BOOT_VOL}/piclaw-network"
    cat > "${BOOT_VOL}/piclaw-network/wifi-setup.sh" << WIFI_NM
#!/bin/bash
# Setup WiFi via NetworkManager (Bookworm)
# Eseguire se wpa_supplicant non funziona automaticamente:
#   sudo bash /boot/firmware/piclaw-network/wifi-setup.sh

nmcli device wifi connect "${WIFI_SSID}" password "${WIFI_PASS}" 2>/dev/null || \
    echo "NetworkManager non disponibile o WiFi gia' connesso"

# Verifica
sleep 5
ip addr show wlan0 2>/dev/null | grep "inet "
WIFI_NM
    chmod +x "${BOOT_VOL}/piclaw-network/wifi-setup.sh"
    
else
    info "WiFi saltato. Usa cavo Ethernet per il primo collegamento."
fi

# ─── Step 5: Riepilogo e istruzioni ─────────────────────────────────────────
info "Step 5/5: Finalizzazione..."

# Crea un file di riferimento rapido sulla SD
cat > "${BOOT_VOL}/PICLAW-README.txt" << 'PICLAW_INFO'
===============================================
  PiClaw - Primo Boot
===============================================

PRIMO COLLEGAMENTO:
  1. Inserisci questa microSD nel Raspberry Pi 4
  2. Collega cavo Ethernet (o attendi WiFi se configurato)
  3. Collega alimentatore USB-C 5V/3A
  4. Attendi 1-2 minuti per il boot completo

DA MAC/TERMINALE:
  ssh pi@piclaw.local
  # oppure: ssh pi@<indirizzo-ip>

  # Se hai configurato la chiave SSH, non servira' password.
  # Altrimenti usa la password impostata in RPi Imager.

SETUP CHIAVE SSH (se non fatto automaticamente):
  sudo bash /boot/firmware/piclaw-ssh-setup.sh

SETUP WIFI (se non connesso):
  sudo bash /boot/firmware/piclaw-network/wifi-setup.sh

TROVARE IP DEL PI:
  Da Mac:  ping piclaw.local
  Da Mac:  arp -a | grep raspberry
  Da Mac:  dns-sd -B _ssh._tcp
  Dal Pi:  hostname -I

PROSSIMI STEP:
  git clone https://github.com/Andrea0xeth/Raspberry_claw.git
  cd Raspberry_claw
  sudo bash scripts/01-os-setup/01-initial-setup.sh

===============================================
PICLAW_INFO

log "File di riferimento PICLAW-README.txt creato sulla SD"

# Eject sicuro
echo ""
info "Pronto per eject. Vuoi smontare la microSD?"
read -p "Eject microSD? (y/n): " DO_EJECT

if [[ "$DO_EJECT" == "y" || "$DO_EJECT" == "Y" ]]; then
    # Cerca il disco della microSD
    DISK_ID=$(diskutil list | grep -B4 "$(basename "$BOOT_VOL")" | grep "/dev/disk" | awk '{print $1}' | head -1)
    if [[ -n "$DISK_ID" ]]; then
        diskutil eject "$DISK_ID" 2>/dev/null || diskutil unmountDisk "$DISK_ID" 2>/dev/null || true
        log "microSD espulsa in sicurezza"
    else
        diskutil unmount "$BOOT_VOL" 2>/dev/null || true
        log "Volume smontato"
    fi
fi

# ─── Riepilogo finale ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  microSD PRONTA!${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""
log "SSH abilitato al primo boot"
if [[ -n "${SSH_KEY:-}" ]]; then
    log "Chiave SSH copiata (login senza password)"
fi
if [[ "${SETUP_WIFI:-n}" == "y" || "${SETUP_WIFI:-n}" == "Y" ]]; then
    log "WiFi configurato: ${WIFI_SSID}"
fi
echo ""
echo -e "${BOLD}PROSSIMI PASSI:${NC}"
echo ""
echo "  1. Inserisci la microSD nel Raspberry Pi 4"
echo "  2. Collega Ethernet e/o alimentatore USB-C"
echo "  3. Attendi 1-2 minuti per il primo boot"
echo ""
echo -e "  4. Dal Mac, apri Terminale e connettiti:"
echo ""
echo -e "     ${GREEN}ssh pi@piclaw.local${NC}"
echo ""
echo "     Se piclaw.local non funziona, trova l'IP:"
echo -e "     ${BLUE}ping piclaw.local${NC}"
echo -e "     ${BLUE}arp -a | grep -i 'b8:27\|dc:a6\|d8:3a\|e4:5f\|2c:cf'${NC}"
echo ""
echo "  5. Dopo il login, configura la chiave SSH:"
echo -e "     ${GREEN}sudo bash /boot/firmware/piclaw-ssh-setup.sh${NC}"
echo ""
echo "  6. Poi avvia il setup PiClaw completo:"
echo -e "     ${GREEN}git clone https://github.com/Andrea0xeth/Raspberry_claw.git${NC}"
echo -e "     ${GREEN}cd Raspberry_claw${NC}"
echo -e "     ${GREEN}sudo bash scripts/01-os-setup/01-initial-setup.sh${NC}"
echo ""
