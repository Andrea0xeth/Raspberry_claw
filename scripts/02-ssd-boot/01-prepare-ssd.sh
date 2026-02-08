#!/usr/bin/env bash
###############################################################################
# 01-prepare-ssd.sh
# Prepara SSD 1TB, clona sistema da microSD, configura boot USB
# Eseguire come root: sudo bash 01-prepare-ssd.sh
###############################################################################
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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
echo "============================================================"
echo "  PICLAW - Preparazione SSD e Migrazione Boot"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# ─── Step 1: Rileva SSD ─────────────────────────────────────────────────────
info "Step 1/8: Rilevamento SSD USB..."

# Cerca dispositivi USB storage
SSD_DEV=""
for dev in /dev/sd{a,b,c,d}; do
    if [[ -b "$dev" ]]; then
        # Verifica che sia USB
        DEVPATH=$(udevadm info --query=path --name="$dev" 2>/dev/null || true)
        if echo "$DEVPATH" | grep -q "usb"; then
            SSD_DEV="$dev"
            break
        fi
    fi
done

# Fallback: cerca NVMe su USB (appare come /dev/sda solitamente)
if [[ -z "$SSD_DEV" ]]; then
    # Prova il primo /dev/sd* che non e' la SD
    MMCBLK=$(findmnt -n -o SOURCE / | sed 's/p[0-9]*$//' | sed 's/[0-9]*$//')
    for dev in /dev/sd{a,b,c,d}; do
        if [[ -b "$dev" ]] && [[ "$dev" != "$MMCBLK" ]]; then
            SSD_DEV="$dev"
            break
        fi
    done
fi

if [[ -z "$SSD_DEV" ]]; then
    err "Nessun SSD USB rilevato!"
    err "Verificare:"
    err "  1. SSD collegato alla porta USB 3.0 (blu)"
    err "  2. Adapter USB funzionante"
    err "  3. lsusb mostra il dispositivo"
    exit 1
fi

SSD_SIZE=$(lsblk -b -d -n -o SIZE "$SSD_DEV" 2>/dev/null || echo "0")
SSD_SIZE_GB=$((SSD_SIZE / 1024 / 1024 / 1024))
SSD_MODEL=$(lsblk -d -n -o MODEL "$SSD_DEV" 2>/dev/null | xargs || echo "Unknown")

log "SSD rilevato: $SSD_DEV ($SSD_MODEL, ${SSD_SIZE_GB}GB)"

# ─── Step 2: Verifica UASP ──────────────────────────────────────────────────
info "Step 2/8: Verifica supporto UASP..."

USB_DEV_PATH=$(udevadm info --query=property --name="$SSD_DEV" 2>/dev/null | grep "ID_USB_DRIVER" || true)
if echo "$USB_DEV_PATH" | grep -qi "uas"; then
    log "UASP attivo ✓ (prestazioni ottimali)"
else
    warn "UASP non rilevato. Prestazioni potenzialmente ridotte."
    warn "Verificare che l'adapter supporti UASP."
    info "Continuando comunque..."
fi

# ─── Step 3: Conferma operazione ────────────────────────────────────────────
warn "ATTENZIONE: Tutti i dati su $SSD_DEV verranno CANCELLATI!"
echo ""
info "Dispositivo: $SSD_DEV"
info "Modello: $SSD_MODEL"
info "Dimensione: ${SSD_SIZE_GB}GB"
echo ""

# In modalita' non-interattiva, procedi automaticamente
if [[ -t 0 ]]; then
    read -p "Continuare? (yes/no): " CONFIRM
    if [[ "$CONFIRM" != "yes" ]]; then
        err "Operazione annullata."
        exit 1
    fi
else
    warn "Modalita' non-interattiva: procedendo automaticamente"
fi

# ─── Step 4: Unmount partizioni SSD esistenti ────────────────────────────────
info "Step 3/8: Unmount partizioni SSD..."
for part in "${SSD_DEV}"*; do
    if mountpoint -q "$(findmnt -n -o TARGET "$part" 2>/dev/null)" 2>/dev/null; then
        umount "$part" 2>/dev/null || true
    fi
done
umount "${SSD_DEV}"* 2>/dev/null || true
log "Partizioni SSD smontate"

# ─── Step 5: Partizionamento SSD ────────────────────────────────────────────
info "Step 4/8: Partizionamento SSD..."

# Pulisci tabella partizioni
wipefs -a "$SSD_DEV" 2>/dev/null || true
sgdisk --zap-all "$SSD_DEV" 2>/dev/null || true

# Crea partizioni con parted
# Partizione 1: Boot FAT32 (512MB)
# Partizione 2: Root ext4 (200GB - per OS)
# Partizione 3: Data ext4 (resto - per Ollama/dati)
parted -s "$SSD_DEV" mklabel msdos
parted -s "$SSD_DEV" mkpart primary fat32 1MiB 512MiB
parted -s "$SSD_DEV" mkpart primary ext4 512MiB 200GiB
parted -s "$SSD_DEV" mkpart primary ext4 200GiB 100%
parted -s "$SSD_DEV" set 1 boot on
parted -s "$SSD_DEV" set 1 lba on

# Attendi che le partizioni appaiano
sleep 3
partprobe "$SSD_DEV"
sleep 2

# Determina nomi partizioni
if [[ -b "${SSD_DEV}1" ]]; then
    BOOT_PART="${SSD_DEV}1"
    ROOT_PART="${SSD_DEV}2"
    DATA_PART="${SSD_DEV}3"
elif [[ -b "${SSD_DEV}p1" ]]; then
    BOOT_PART="${SSD_DEV}p1"
    ROOT_PART="${SSD_DEV}p2"
    DATA_PART="${SSD_DEV}p3"
else
    err "Partizioni non trovate dopo creazione!"
    exit 1
fi

# Formatta partizioni
mkfs.vfat -F 32 -n PIBOOT "$BOOT_PART"
mkfs.ext4 -L PIROOT -F "$ROOT_PART"
mkfs.ext4 -L PIDATA -F "$DATA_PART"

log "SSD partizionato: boot(512MB) + root(200GB) + data(~800GB)"

# ─── Step 6: Clone sistema ──────────────────────────────────────────────────
info "Step 5/8: Clone sistema da microSD a SSD..."

# Crea punti di mount temporanei
WORK_DIR="/tmp/ssd-clone"
mkdir -p "${WORK_DIR}/boot" "${WORK_DIR}/root" "${WORK_DIR}/data"

# Monta partizioni SSD
mount "$BOOT_PART" "${WORK_DIR}/boot"
mount "$ROOT_PART" "${WORK_DIR}/root"
mount "$DATA_PART" "${WORK_DIR}/data"

# Trova boot corrente
CURRENT_BOOT=""
if mountpoint -q /boot/firmware; then
    CURRENT_BOOT="/boot/firmware"
elif mountpoint -q /boot; then
    CURRENT_BOOT="/boot"
fi

# Clone boot partition
if [[ -n "$CURRENT_BOOT" ]]; then
    info "Clonando partizione boot da $CURRENT_BOOT..."
    rsync -axHAWXS --numeric-ids --info=progress2 \
        "$CURRENT_BOOT/" "${WORK_DIR}/boot/"
    log "Boot partition clonata"
else
    warn "Boot partition non trovata, skipping boot clone"
fi

# Clone root partition (escludi mount points e temp)
info "Clonando partizione root (questo richiede tempo)..."
rsync -axHAWXS --numeric-ids --info=progress2 \
    --exclude='/proc/*' \
    --exclude='/sys/*' \
    --exclude='/dev/*' \
    --exclude='/tmp/*' \
    --exclude='/run/*' \
    --exclude='/mnt/*' \
    --exclude='/media/*' \
    --exclude='/lost+found' \
    --exclude='/boot/firmware/*' \
    --exclude="${WORK_DIR}" \
    / "${WORK_DIR}/root/"

# Crea directory necessarie nel root clonato
mkdir -p "${WORK_DIR}/root"/{proc,sys,dev,tmp,run,mnt,media,boot/firmware}
log "Root partition clonata"

# Crea struttura dati su partizione data
mkdir -p "${WORK_DIR}/data"/{ollama,models,rag,backups,logs}
log "Partizione dati preparata"

# ─── Step 7: Configura fstab e boot ─────────────────────────────────────────
info "Step 6/8: Configurazione fstab e boot parameters..."

# Ottieni PARTUUID
BOOT_PARTUUID=$(blkid -s PARTUUID -o value "$BOOT_PART")
ROOT_PARTUUID=$(blkid -s PARTUUID -o value "$ROOT_PART")
DATA_PARTUUID=$(blkid -s PARTUUID -o value "$DATA_PART")

log "PARTUUID boot: $BOOT_PARTUUID"
log "PARTUUID root: $ROOT_PARTUUID"
log "PARTUUID data: $DATA_PARTUUID"

# Aggiorna fstab nel root clonato
cat > "${WORK_DIR}/root/etc/fstab" << FSTAB
# /etc/fstab - PiClaw SSD Boot Configuration
# <device>                                  <mount>          <type>  <options>                    <dump> <pass>
PARTUUID=${BOOT_PARTUUID}  /boot/firmware   vfat    defaults,flush                0      2
PARTUUID=${ROOT_PARTUUID}  /                ext4    defaults,noatime,nodiratime   0      1
PARTUUID=${DATA_PARTUUID}  /data            ext4    defaults,noatime,nodiratime   0      2
tmpfs                      /tmp             tmpfs   defaults,nosuid,nodev,size=512M  0   0
FSTAB

# Crea /data mount point nel root
mkdir -p "${WORK_DIR}/root/data"

log "fstab aggiornato con PARTUUID SSD"

# Aggiorna cmdline.txt per boot da SSD
CMDLINE_FILE=""
if [[ -f "${WORK_DIR}/boot/cmdline.txt" ]]; then
    CMDLINE_FILE="${WORK_DIR}/boot/cmdline.txt"
elif [[ -f "${WORK_DIR}/boot/firmware/cmdline.txt" ]]; then
    CMDLINE_FILE="${WORK_DIR}/boot/firmware/cmdline.txt"
fi

if [[ -n "$CMDLINE_FILE" ]]; then
    # Backup
    cp "$CMDLINE_FILE" "${CMDLINE_FILE}.bak"
    
    # Aggiorna root= parameter
    sed -i "s|root=PARTUUID=[^ ]*|root=PARTUUID=${ROOT_PARTUUID}|g" "$CMDLINE_FILE"
    sed -i "s|root=/dev/[^ ]*|root=PARTUUID=${ROOT_PARTUUID}|g" "$CMDLINE_FILE"
    
    # Aggiungi rootfstype se mancante
    if ! grep -q "rootfstype=" "$CMDLINE_FILE"; then
        sed -i "s/$/ rootfstype=ext4/" "$CMDLINE_FILE"
    fi
    
    log "cmdline.txt aggiornato: root=PARTUUID=${ROOT_PARTUUID}"
else
    warn "cmdline.txt non trovato!"
fi

# ─── Step 8: Finalizza ──────────────────────────────────────────────────────
info "Step 7/8: Sync e unmount..."
sync
umount "${WORK_DIR}/boot"
umount "${WORK_DIR}/root"
umount "${WORK_DIR}/data"
rmdir "${WORK_DIR}"/{boot,root,data} "${WORK_DIR}" 2>/dev/null || true
log "SSD sincronizzato e smontato"

# ─── Step 8: Aggiorna boot order EEPROM ──────────────────────────────────────
info "Step 8/8: Configurazione boot order EEPROM..."

if command -v raspi-config &>/dev/null; then
    # B2 = USB Boot
    raspi-config nonint do_boot_order B2 2>/dev/null || true
    log "Boot order: USB first"
fi

# ─── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  SSD PREPARATO - PRONTO PER BOOT"
echo "============================================================"
echo ""
log "SSD partizionato e formattato:"
info "  Boot:  $BOOT_PART (512MB, FAT32)"
info "  Root:  $ROOT_PART (200GB, ext4)"
info "  Data:  $DATA_PART (~800GB, ext4, /data)"
echo ""
log "Sistema clonato da microSD a SSD"
log "fstab e cmdline.txt aggiornati"
log "Boot order configurato: USB first"
echo ""
warn "PROSSIMO STEP:"
info "  1. sudo shutdown -h now"
info "  2. (Opzionale) Rimuovi microSD"
info "  3. Accendi il Pi - dovrebbe bootare da SSD"
info "  4. Dopo boot, esegui:"
info "     sudo bash scripts/02-ssd-boot/02-post-ssd-boot.sh"
echo ""
warn "NOTA: Se il boot da SSD fallisce, reinserisci microSD e verifica"
warn "il boot order con: sudo rpi-eeprom-config"
echo ""
