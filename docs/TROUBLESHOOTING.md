# PiClaw - Guida Troubleshooting

Guida completa per risolvere i problemi piu' comuni durante l'installazione e l'uso di PiClaw.

---

## Indice

1. [Hardware / SSD](#1-hardware--ssd)
2. [Boot da USB](#2-boot-da-usb)
3. [Ollama / AI](#3-ollama--ai)
4. [OpenClaw Agent](#4-openclaw-agent)
5. [GPIO / Hardware](#5-gpio--hardware)
6. [Performance](#6-performance)
7. [Rete](#7-rete)
8. [Comandi Diagnostici Rapidi](#8-comandi-diagnostici-rapidi)

---

## 1. Hardware / SSD

### SSD non riconosciuto

**Sintomo**: `lsblk` non mostra `/dev/sda`

**Soluzioni**:

```bash
# 1. Verifica che il device sia rilevato via USB
lsusb
# Dovrebbe mostrare il chipset dell'adapter (RTL9210, JMS583, etc.)

# 2. Controlla dmesg per errori
dmesg | tail -50
dmesg | grep -i "usb\|scsi\|error"

# 3. Verifica porta USB
# Assicurati di usare le porte USB 3.0 (BLU, non nere)
# Le porte USB 3.0 su RPi4 sono le due centrali

# 4. Prova altro adapter/cavo
# Adapter economici senza UASP causano problemi

# 5. Reset USB
echo "1-1" | sudo tee /sys/bus/usb/drivers/usb/unbind
sleep 2
echo "1-1" | sudo tee /sys/bus/usb/drivers/usb/bind
```

### UASP non attivo

**Sintomo**: Performance I/O basse (< 200 MB/s)

```bash
# Verifica driver in uso
cat /sys/block/sda/device/modalias
# Se mostra "usb:..." senza "uas" nel driver:

# Controlla quale driver e' attivo
lsusb -t | grep -i "driver"
# "uas" = UASP attivo (ottimo)
# "usb-storage" = UASP non attivo (lento)

# Forza UASP (se supportato dall'adapter)
# Aggiungi a /boot/firmware/cmdline.txt:
# usb-storage.quirks=VENDOR:PRODUCT:u
# Esempio per JMicron JMS583:
# usb-storage.quirks=152d:0583:u
```

### SSD si disconnette casualmente

```bash
# Potrebbe essere problema di alimentazione
# Verifica se c'e' under-voltage
vcgencmd get_throttled
# 0x0 = OK
# 0x50005 = Under-voltage detected

# Soluzione: usa alimentatore ufficiale 5V/3A
# Se il SSD richiede troppa corrente, usa hub USB alimentato
```

---

## 2. Boot da USB

### Il Pi non boota da SSD

```bash
# 1. Verifica EEPROM boot order
sudo rpi-eeprom-config
# BOOT_ORDER dovrebbe contenere 0x4 (USB)
# Esempio: BOOT_ORDER=0xf41 (USB -> SD -> restart)

# 2. Aggiorna EEPROM
sudo rpi-eeprom-update -a
sudo reboot

# 3. Forza boot order via raspi-config
sudo raspi-config
# Advanced Options -> Boot Order -> USB Boot

# 4. Manualmente
sudo -E rpi-eeprom-config --edit
# Imposta: BOOT_ORDER=0xf14
# USB=4, SD=1, restart=f

# 5. Verifica partizione boot SSD
# La partizione boot deve essere FAT32 con flag boot
sudo fdisk -l /dev/sda
# Partizione 1 dovrebbe avere tipo W95 FAT32 (LBA)
```

### Boot lento da USB

```bash
# Aggiorna firmware per migliorare init USB
sudo apt update && sudo apt full-upgrade
sudo rpi-eeprom-update -a

# Verifica che UASP sia attivo (vedi sopra)

# Riduci timeout boot
sudo -E rpi-eeprom-config --edit
# USB_MSD_STARTUP_DELAY=0
# USB_MSD_LUN_TIMEOUT=10000
```

### cmdline.txt con PARTUUID errato

```bash
# Trova PARTUUID corretto del SSD
sudo blkid
# Cerca la partizione ext4 del SSD (es. /dev/sda2)

# Aggiorna cmdline.txt
sudo nano /boot/firmware/cmdline.txt
# Cambia root=PARTUUID=XXXXX con il PARTUUID corretto

# Verifica
cat /boot/firmware/cmdline.txt
```

---

## 3. Ollama / AI

### Ollama non si avvia

```bash
# 1. Controlla log servizio
sudo journalctl -u ollama -f --no-pager -n 50

# 2. Verifica binario
which ollama
ollama --version

# 3. Reinstalla
curl -fsSL https://ollama.com/install.sh | sh

# 4. Controlla porta in uso
ss -tlnp | grep 11434
# Se occupata da altro processo, killarlo

# 5. Avvia manualmente per debug
sudo OLLAMA_DEBUG=1 ollama serve
```

### Ollama Out of Memory (OOM)

```bash
# 1. Verifica RAM disponibile
free -h

# 2. Usa modello piu' piccolo
ollama pull llama3.2:1b  # ~600MB RAM
# Invece di llama3.2:8b  # ~5GB RAM

# 3. Aumenta swap
sudo dphys-swapfile swapoff
sudo sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=8192/' /etc/dphys-swapfile
sudo dphys-swapfile setup
sudo dphys-swapfile swapon

# 4. Riduci threads
# In /etc/default/ollama:
OLLAMA_NUM_PARALLEL=1
OLLAMA_MAX_LOADED_MODELS=1

# 5. Limita memoria nel service
sudo systemctl edit ollama
# Aggiungi:
# [Service]
# MemoryMax=5G
```

### Modello lento / inference lenta

```bash
# 1. Verifica che stia usando modello quantizzato Q4
ollama list
# Il nome dovrebbe contenere "q4" o "Q4_K_M"

# 2. Usa modello piu' piccolo
ollama pull llama3.2:1b  # Veloce su RPi4

# 3. Riduci context window
# Nel Modelfile:
# PARAMETER num_ctx 2048  # Invece di 4096

# 4. Verifica non ci sia swap thrashing
vmstat 1 5
# Se "si" e "so" sono alti, la RAM non basta

# 5. Performance attesa su RPi4 8GB:
# llama3.2:1b Q4 → ~10-15 tokens/sec
# llama3.2:3b Q4 → ~3-6 tokens/sec
# llama3.2:8b Q4 → ~1-2 tokens/sec (non consigliato)
```

### Modello non trovato

```bash
# Lista modelli installati
ollama list

# Se piclaw-agent non c'e', ricrealo
cd /path/to/Raspberry_claw
ollama create piclaw-agent -f models/Modelfile.piclaw-agent

# Verifica che il modello base sia presente
ollama list | grep llama3.2
# Se manca:
ollama pull llama3.2:3b

# Modelli su SSD?
ls -la /data/ollama/models/
```

---

## 4. OpenClaw Agent

### Servizio non si avvia

```bash
# 1. Controlla log
sudo journalctl -u openclaw -f --no-pager -n 50

# 2. Verifica Node.js
node --version  # Deve essere >= 18

# 3. Installa dipendenze
cd /opt/openclaw/src
sudo npm install

# 4. Test manuale
cd /opt/openclaw/src
sudo node index.js
# Guarda errori in console

# 5. Verifica file .env
cat /opt/openclaw/config/.env

# 6. Verifica che Ollama sia attivo (dipendenza)
sudo systemctl status ollama
```

### Permission denied

```bash
# 1. Verifica utente openclaw
id openclaw
# Deve essere nei gruppi: gpio, i2c, spi, dialout, docker

# 2. Verifica sudoers
sudo visudo -c -f /etc/sudoers.d/openclaw
sudo cat /etc/sudoers.d/openclaw

# 3. Test sudo NOPASSWD
sudo -u openclaw sudo -n whoami
# Deve ritornare "root" senza chiedere password

# 4. Ricrea sudoers se corrotto
sudo cp config/sudoers/openclaw /etc/sudoers.d/openclaw
sudo chmod 440 /etc/sudoers.d/openclaw

# 5. Capabilities
sudo setcap 'cap_sys_rawio,cap_net_admin,cap_net_raw+eip' $(which node)
```

### API non risponde

```bash
# 1. Verifica porta
curl http://localhost:3100/health

# 2. Controlla binding
ss -tlnp | grep 3100

# 3. Firewall
sudo ufw status
sudo ufw allow 3100/tcp

# 4. Restart
sudo systemctl restart openclaw
```

---

## 5. GPIO / Hardware

### GPIO access denied

```bash
# 1. Aggiungi utente ai gruppi
sudo usermod -aG gpio,i2c,spi,dialout $USER
# Logout/login necessario

# 2. Verifica permessi /dev/gpiomem
ls -la /dev/gpiomem
# Deve essere: crw-rw---- root gpio

# 3. Udev rules per GPIO
sudo cat > /etc/udev/rules.d/99-gpio.rules << 'EOF'
SUBSYSTEM=="gpio", GROUP="gpio", MODE="0660"
SUBSYSTEM=="gpio*", GROUP="gpio", MODE="0660"
EOF
sudo udevadm control --reload-rules

# 4. Alternativa: usa sudo
sudo python3 tools/gpio_controller.py --pin 17 --action read
```

### I2C device non trovato

```bash
# 1. Verifica I2C abilitato
sudo raspi-config nonint get_i2c
# 0 = abilitato, 1 = disabilitato

# 2. Abilita I2C
sudo raspi-config nonint do_i2c 0

# 3. Verifica device
ls -la /dev/i2c*
# Deve mostrare /dev/i2c-1

# 4. Scan I2C
sudo i2cdetect -y 1
# Mostra griglia con indirizzi dei device connessi

# 5. Carica modulo kernel
sudo modprobe i2c-dev
echo "i2c-dev" | sudo tee -a /etc/modules
```

---

## 6. Performance

### Sistema lento / alta latenza

```bash
# 1. Controlla carico CPU
htop
# oppure
top -bn1 | head -20

# 2. Controlla memoria
free -h
# Se swap e' molto usato, serve piu' RAM o meno processi

# 3. Controlla I/O
iotop -o
# Mostra processi con I/O attivo

# 4. Controlla temperatura (throttling)
vcgencmd measure_temp
vcgencmd get_throttled
# Se throttling attivo, migliorare raffreddamento

# 5. Verifica swappiness
cat /proc/sys/vm/swappiness
# Deve essere <= 10 per SSD
echo 10 | sudo tee /proc/sys/vm/swappiness
```

### Temperatura troppo alta (> 80°C)

```bash
# 1. Installa dissipatore + ventola attiva

# 2. Riduci frequenza CPU temporaneamente
echo "1200000" | sudo tee /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq

# 3. Riduci GPU memory
# In /boot/firmware/config.txt:
gpu_mem=16

# 4. Disabilita overclock
# Commenta in /boot/firmware/config.txt:
# over_voltage=0
# arm_freq=1800

# 5. Riduci carico Ollama
# Usa modello piu' piccolo o limita threads
```

---

## 7. Rete

### WiFi non si connette al primo boot

**Sintomo**: Hai configurato il WiFi in RPi Imager ma il Pi non si connette.

```bash
# Se hai accesso via Ethernet o monitor, controlla:

# 1. Verifica che l'interfaccia WiFi esista
ip link show wlan0
# Se non compare: il WiFi potrebbe essere disabilitato

# 2. Controlla se e' connesso
iwconfig wlan0
# Cerca "ESSID" - se mostra il nome della tua rete, e' connesso

# 3. Verifica IP assegnato
ip addr show wlan0
# Cerca "inet 192.168.x.x" - se c'e', il WiFi funziona

# 4. Se non connesso, prova con NetworkManager (Bookworm)
sudo nmcli device wifi list
# Mostra le reti disponibili. Cerca la tua.

sudo nmcli device wifi connect "NOME-TUA-RETE" password "TUA-PASSWORD"
# Connetti manualmente

# 5. Se hai eseguito lo script Mac e hai il file sulla SD:
sudo bash /boot/firmware/piclaw-network/wifi-setup.sh

# 6. Verifica paese WiFi (essenziale per i canali)
sudo raspi-config nonint get_wifi_country
# Deve essere IT (o il tuo paese)
sudo raspi-config nonint do_wifi_country IT
```

**Cause comuni**:
- SSID o password scritti male in RPi Imager (attenzione a maiuscole/minuscole!)
- Paese WiFi sbagliato (impedisce l'uso di certi canali)
- Rete a 5GHz: il Pi 4 la supporta, ma se il segnale e' debole prova 2.4GHz
- Rete con "spazio" nel nome: dovrebbe funzionare, ma verificare

### No internet

```bash
# 1. Test connettivita'
ping -c 3 8.8.8.8

# 2. Se ping IP funziona ma non domini:
ping -c 3 google.com
# Problema DNS
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf

# 3. Verifica interfaccia
ip addr show
ip link show

# 4. DHCP
sudo dhclient eth0
# oppure
sudo dhcpcd eth0

# 5. WiFi
sudo iwconfig wlan0
sudo nmcli device wifi list
```

### Porta bloccata da firewall

```bash
# Verifica stato UFW
sudo ufw status verbose

# Apri porte necessarie
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 3100/tcp  # OpenClaw
sudo ufw allow 11434/tcp # Ollama

# Disabilita temporaneamente per test
sudo ufw disable
```

---

## 8. Comandi Diagnostici Rapidi

```bash
# ─── Quick Health Check ─────────────────────────
echo "=== SYSTEM ==="
uname -a
uptime
free -h

echo "=== TEMPERATURE ==="
vcgencmd measure_temp 2>/dev/null || echo "N/A"
vcgencmd get_throttled 2>/dev/null || echo "N/A"

echo "=== STORAGE ==="
df -h / /data 2>/dev/null
lsblk

echo "=== SERVICES ==="
for svc in ollama openclaw docker ssh; do
    echo "$svc: $(systemctl is-active $svc 2>/dev/null || echo 'not found')"
done

echo "=== NETWORK ==="
ip -4 addr show | grep inet
ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1 && echo "Internet: OK" || echo "Internet: FAIL"

echo "=== OLLAMA ==="
ollama list 2>/dev/null || echo "Ollama not available"
curl -s http://localhost:11434/api/version 2>/dev/null || echo "Ollama API not responding"

echo "=== OPENCLAW ==="
curl -s http://localhost:3100/health 2>/dev/null || echo "OpenClaw API not responding"
```

### Script diagnostico completo

Eseguire la suite di test:

```bash
sudo bash scripts/06-testing/01-run-tests.sh
```

---

## Log Utili

| Servizio | Comando Log |
|---|---|
| Ollama | `sudo journalctl -u ollama -f` |
| OpenClaw | `sudo journalctl -u openclaw -f` |
| Sistema | `sudo journalctl -f` |
| Boot | `sudo journalctl -b` |
| OpenClaw file | `tail -f /data/logs/openclaw/agent.log` |
| Storage monitor | `tail -f /data/logs/storage-monitor.log` |
| GPIO | `tail -f /data/logs/gpio.log` |
| Decision engine | `tail -f /data/logs/decision-engine/decisions.log` |

---

## Reset Completo

Se tutto il resto fallisce:

```bash
# 1. Backup dati importanti
sudo rsync -av /data/rag/ /tmp/backup_rag/
sudo rsync -av /data/ollama/models/ /tmp/backup_models/

# 2. Reinstalla servizi
sudo systemctl stop openclaw ollama
sudo rm -rf /opt/openclaw/src/node_modules
cd /opt/openclaw/src && sudo npm install
sudo systemctl restart ollama
sleep 10
sudo systemctl restart openclaw

# 3. Ricrea modelli AI
ollama create piclaw-agent -f models/Modelfile.piclaw-agent
ollama create piclaw-coder -f models/Modelfile.piclaw-coder

# 4. Verifica
sudo bash scripts/06-testing/01-run-tests.sh
```
