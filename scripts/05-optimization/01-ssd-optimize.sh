#!/usr/bin/env bash
###############################################################################
# 01-ssd-optimize.sh
# Ottimizzazioni sistema per SSD 1TB, performance AI e longevita
# Eseguire come root: sudo bash 01-ssd-optimize.sh
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
echo "  PICLAW - Ottimizzazioni SSD e Sistema"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# ─── 1. I/O Scheduler ───────────────────────────────────────────────────────
info "1/10: Configurazione I/O scheduler..."

# Trova il device SSD
ROOT_DEV=$(findmnt -n -o SOURCE / | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//')
ROOT_DEV_NAME=$(basename "$ROOT_DEV")

# Imposta 'none' (noop) per SSD - ottimale per flash storage
if [[ -f "/sys/block/${ROOT_DEV_NAME}/queue/scheduler" ]]; then
    echo "none" > "/sys/block/${ROOT_DEV_NAME}/queue/scheduler" 2>/dev/null || true
    CURRENT_SCHED=$(cat "/sys/block/${ROOT_DEV_NAME}/queue/scheduler" 2>/dev/null)
    log "I/O scheduler: $CURRENT_SCHED"
else
    warn "Scheduler non configurabile per ${ROOT_DEV_NAME}"
fi

# Rendi persistente via udev rule
cat > /etc/udev/rules.d/60-ssd-scheduler.rules << 'UDEV_RULES'
# Set I/O scheduler to none for SSD/NVMe
ACTION=="add|change", KERNEL=="sd[a-z]", ATTR{queue/rotational}=="0", ATTR{queue/scheduler}="none"
ACTION=="add|change", KERNEL=="nvme[0-9]*", ATTR{queue/scheduler}="none"
UDEV_RULES
log "I/O scheduler udev rule creata"

# ─── 2. Mount Options ───────────────────────────────────────────────────────
info "2/10: Ottimizzazione mount options..."

# Verifica che fstab abbia opzioni ottimali
if grep -q "noatime" /etc/fstab; then
    log "noatime gia' configurato in fstab"
else
    warn "Aggiungere manualmente noatime,nodiratime in /etc/fstab"
fi

# Remount con opzioni ottimizzate (se possibile)
mount -o remount,noatime,nodiratime / 2>/dev/null || true
log "Mount options applicati"

# ─── 3. TRIM/Discard (fstrim) ───────────────────────────────────────────────
info "3/10: Configurazione TRIM settimanale..."

# Abilita fstrim timer (settimanale)
systemctl enable fstrim.timer 2>/dev/null || true
systemctl start fstrim.timer 2>/dev/null || true

# Crea anche un override per frequenza personalizzata
mkdir -p /etc/systemd/system/fstrim.timer.d/
cat > /etc/systemd/system/fstrim.timer.d/override.conf << 'FSTRIM_OVERRIDE'
[Timer]
OnCalendar=
OnCalendar=weekly
Persistent=true
FSTRIM_OVERRIDE

systemctl daemon-reload
log "fstrim settimanale abilitato"

# Esegui TRIM adesso
fstrim -v / 2>/dev/null || true
fstrim -v /data 2>/dev/null || true
log "TRIM eseguito"

# ─── 4. Sysctl Performance ──────────────────────────────────────────────────
info "4/10: Ottimizzazione parametri kernel..."

cat > /etc/sysctl.d/99-piclaw-ssd.conf << 'SYSCTL_SSD'
# PiClaw SSD Optimization
# Riduce scritture inutili su SSD

# Swappiness bassa - preferisci RAM
vm.swappiness=10

# Dirty pages - riduce flush frequency
vm.dirty_ratio=15
vm.dirty_background_ratio=5
vm.dirty_expire_centisecs=3000
vm.dirty_writeback_centisecs=1500

# VFS cache - bilancia tra RAM e I/O
vm.vfs_cache_pressure=50

# Network performance
net.core.somaxconn=1024
net.core.netdev_max_backlog=5000
net.ipv4.tcp_max_syn_backlog=1024
net.ipv4.tcp_fastopen=3

# File descriptors
fs.file-max=200000
fs.inotify.max_user_watches=524288
fs.inotify.max_user_instances=512

# Shared memory per AI
kernel.shmmax=4294967296
kernel.shmall=1048576
SYSCTL_SSD

sysctl -p /etc/sysctl.d/99-piclaw-ssd.conf 2>/dev/null || true
log "Parametri kernel ottimizzati"

# ─── 5. tmpfs per directory volatili ─────────────────────────────────────────
info "5/10: Configurazione tmpfs per directory volatili..."

# /tmp su tmpfs (se non gia' configurato)
if ! grep -q "tmpfs.*/tmp" /etc/fstab; then
    echo "tmpfs   /tmp    tmpfs   defaults,nosuid,nodev,size=512M  0  0" >> /etc/fstab
    mount -o remount /tmp 2>/dev/null || mount tmpfs /tmp -t tmpfs -o defaults,nosuid,nodev,size=512M 2>/dev/null || true
fi

# Log volatili su tmpfs
if ! grep -q "tmpfs.*/var/log/piclaw-volatile" /etc/fstab; then
    mkdir -p /var/log/piclaw-volatile
    echo "tmpfs   /var/log/piclaw-volatile  tmpfs   defaults,nosuid,nodev,size=128M  0  0" >> /etc/fstab
    mount /var/log/piclaw-volatile 2>/dev/null || true
fi

log "tmpfs configurato per /tmp e log volatili"

# ─── 6. Log Rotation aggressiva ─────────────────────────────────────────────
info "6/10: Configurazione log rotation..."

cat > /etc/logrotate.d/piclaw << 'LOGROTATE'
/data/logs/openclaw/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 openclaw openclaw
    postrotate
        systemctl reload openclaw 2>/dev/null || true
    endscript
}

/var/log/syslog
/var/log/auth.log
/var/log/kern.log {
    daily
    missingok
    rotate 3
    compress
    delaycompress
    notifempty
}
LOGROTATE

log "Log rotation configurata (7 giorni openclaw, 3 giorni sistema)"

# ─── 7. Journald limiting ───────────────────────────────────────────────────
info "7/10: Limitazione journald..."

mkdir -p /etc/systemd/journald.conf.d/
cat > /etc/systemd/journald.conf.d/piclaw.conf << 'JOURNALD'
[Journal]
SystemMaxUse=200M
SystemKeepFree=1G
MaxRetentionSec=7day
Compress=yes
ForwardToSyslog=no
JOURNALD

systemctl restart systemd-journald 2>/dev/null || true
log "Journald limitato a 200MB / 7 giorni"

# ─── 8. Read-ahead optimization ─────────────────────────────────────────────
info "8/10: Ottimizzazione read-ahead..."

if [[ -f "/sys/block/${ROOT_DEV_NAME}/queue/read_ahead_kb" ]]; then
    # 256KB read-ahead per SSD (default e' spesso 128KB)
    echo 256 > "/sys/block/${ROOT_DEV_NAME}/queue/read_ahead_kb" 2>/dev/null || true
    log "Read-ahead: 256KB"
fi

# Rendi persistente
cat > /etc/udev/rules.d/61-ssd-readahead.rules << 'UDEV_RA'
ACTION=="add|change", KERNEL=="sd[a-z]", ATTR{queue/rotational}=="0", ATTR{queue/read_ahead_kb}="256"
UDEV_RA

# ─── 9. Storage monitoring ──────────────────────────────────────────────────
info "9/10: Setup monitoring storage..."

# Crea script di monitoring
cat > /usr/local/bin/piclaw-storage-monitor << 'MONITOR_SCRIPT'
#!/usr/bin/env bash
# PiClaw Storage Monitor - Controlla spazio disco e salute SSD

LOG_FILE="/data/logs/storage-monitor.log"
ALERT_THRESHOLD=90  # Percentuale

log_msg() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Controlla spazio su tutte le partizioni
while IFS= read -r line; do
    MOUNT=$(echo "$line" | awk '{print $6}')
    USE_PCT=$(echo "$line" | awk '{print $5}' | tr -d '%')
    AVAIL=$(echo "$line" | awk '{print $4}')
    
    if [[ $USE_PCT -ge $ALERT_THRESHOLD ]]; then
        log_msg "ALERT: $MOUNT al ${USE_PCT}% (liberi: $AVAIL)"
        
        # Se critico (>95%), pulizia automatica
        if [[ $USE_PCT -ge 95 ]]; then
            log_msg "CRITICAL: Pulizia automatica su $MOUNT"
            # Pulizia cache apt
            apt-get clean 2>/dev/null
            # Pulizia journal vecchi
            journalctl --vacuum-time=3d 2>/dev/null
            # Pulizia tmp
            find /tmp -type f -atime +1 -delete 2>/dev/null
            log_msg "Pulizia completata"
        fi
    fi
done < <(df -h --output=source,size,used,avail,pcent,target | tail -n +2 | grep -v tmpfs)

# Controlla SMART se disponibile
if command -v smartctl &>/dev/null; then
    ROOT_DEV=$(findmnt -n -o SOURCE / | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//')
    SMART_HEALTH=$(smartctl -H "$ROOT_DEV" 2>/dev/null | grep -i "health\|result" | head -1 || echo "N/A")
    log_msg "SMART: $SMART_HEALTH"
fi

# Controlla dimensione modelli Ollama
if [[ -d /data/ollama/models ]]; then
    MODELS_SIZE=$(du -sh /data/ollama/models 2>/dev/null | awk '{print $1}')
    log_msg "INFO: Modelli Ollama: $MODELS_SIZE"
fi
MONITOR_SCRIPT
chmod +x /usr/local/bin/piclaw-storage-monitor

# Cron job per monitoring ogni ora
cat > /etc/cron.d/piclaw-storage << 'CRON_STORAGE'
# PiClaw Storage Monitor - ogni ora
0 * * * * root /usr/local/bin/piclaw-storage-monitor
CRON_STORAGE

log "Storage monitoring configurato (ogni ora)"

# ─── 10. Benchmark veloce ───────────────────────────────────────────────────
info "10/10: Benchmark rapido SSD..."

echo ""
info "Test scrittura sequenziale (256MB)..."
WRITE_RESULT=$(dd if=/dev/zero of=/tmp/bench_write bs=1M count=256 conv=fdatasync 2>&1 | tail -1)
echo "  $WRITE_RESULT"
rm -f /tmp/bench_write

info "Test lettura sequenziale (256MB)..."
echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
READ_RESULT=$(dd if="$ROOT_DEV" of=/dev/null bs=1M count=256 2>&1 | tail -1)
echo "  $READ_RESULT"

# Test 4K random (approssimativo)
info "Test 4K random write..."
RANDOM_RESULT=$(dd if=/dev/zero of=/tmp/bench_4k bs=4K count=10000 conv=fdatasync 2>&1 | tail -1)
echo "  $RANDOM_RESULT"
rm -f /tmp/bench_4k

# ─── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  OTTIMIZZAZIONI COMPLETATE"
echo "============================================================"
echo ""
log "I/O scheduler: none (noop) per SSD"
log "Mount options: noatime, nodiratime"
log "TRIM: settimanale (fstrim.timer)"
log "Kernel: swappiness=10, dirty ratio ottimizzato"
log "tmpfs: /tmp (512MB), log volatili (128MB)"
log "Log rotation: 7 giorni (openclaw), 3 giorni (sistema)"
log "Journald: max 200MB, 7 giorni retention"
log "Read-ahead: 256KB"
log "Storage monitor: cron ogni ora, alert >90%"
echo ""

# Stato storage
info "Stato storage attuale:"
df -h / /data /tmp 2>/dev/null | column -t
echo ""

info "PROSSIMO STEP:"
info "  sudo bash scripts/06-testing/01-run-tests.sh"
echo ""
