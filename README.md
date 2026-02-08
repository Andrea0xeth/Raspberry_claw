# Raspberry Claw - Sistema Agente AI Autonomo per Raspberry Pi 4

> **Progetto completo step-by-step**: Raspberry Pi 4 (8GB) + 1TB SSD + OpenClaw + Ollama AI Engine
> per un agente AI autonomo con accesso completo all'hardware.

---

## Indice

0. [**Step 0 - Setup SSH dal Mac (Primo Collegamento)**](#step-0---setup-ssh-dal-mac)
1. [Panoramica Architettura](#panoramica-architettura)
2. [Prerequisiti Hardware](#prerequisiti-hardware)
3. [Prerequisiti Software](#prerequisiti-software)
4. [Quick Start (Setup Automatico)](#quick-start)
5. [Step 1 - Installazione OS e Boot da SSD](#step-1---installazione-os-e-boot-da-ssd)
6. [Step 2 - Setup OpenClaw con Accesso Root](#step-2---setup-openclaw-con-accesso-root)
7. [Step 3 - AI Engine con Ollama](#step-3---ai-engine-con-ollama)
8. [Step 4 - Modello AI Custom](#step-4---modello-ai-custom)
9. [Step 5 - Ottimizzazioni 1TB SSD](#step-5---ottimizzazioni-1tb-ssd)
10. [Step 6 - Test e Validazione](#step-6---test-e-validazione)
11. [Troubleshooting](#troubleshooting)
12. [Struttura Progetto](#struttura-progetto)

---

## Panoramica Architettura

```
┌─────────────────────────────────────────────────────────┐
│                   RASPBERRY PI 4 (8GB)                  │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  microSD    │  │  1TB NVMe    │  │    GPIO/I2C   │  │
│  │  (boot fw)  │  │  SSD (USB3)  │  │   Hardware    │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                │                   │          │
│  ┌──────┴────────────────┴───────────────────┴───────┐  │
│  │         Raspberry Pi OS 64-bit Lite               │  │
│  │         (rootfs su SSD / boot su SD)              │  │
│  └───────────────────┬───────────────────────────────┘  │
│                      │                                  │
│  ┌───────────────────┴───────────────────────────────┐  │
│  │              OPENCLAW (systemd root)              │  │
│  │  ┌─────────────┐  ┌────────────┐  ┌───────────┐  │  │
│  │  │ Shell Tool  │  │ GPIO Tool  │  │ File Tool │  │  │
│  │  │ (bash/sudo) │  │ (python)   │  │ (r/w/x)   │  │  │
│  │  └──────┬──────┘  └─────┬──────┘  └─────┬─────┘  │  │
│  │         └────────────────┼───────────────┘        │  │
│  └──────────────────────────┼────────────────────────┘  │
│                             │                           │
│  ┌──────────────────────────┴────────────────────────┐  │
│  │           OLLAMA AI ENGINE (on SSD)               │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │  Llama 3.2 8B/13B (Q4_K_M quantized)       │  │  │
│  │  │  Custom Modelfile: decision-maker prompt    │  │  │
│  │  │  RAG: documenti + contesto hardware         │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  │  Storage: /data/ollama (1TB SSD)                  │  │
│  │  API: http://localhost:11434                       │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Prerequisiti Hardware

| Componente | Specifica | Note |
|---|---|---|
| **Raspberry Pi 4** | Model B, 8GB RAM | Essenziale per AI inference |
| **microSD** | 32GB Class 10/A2 | Solo per boot iniziale + firmware |
| **SSD 1TB** | USB-C esterno o NVMe in enclosure | Tutto il software gira da qui |
| **Adattatore USB-C → USB-A** | USB 3.0 | **Solo se** il tuo SSD ha connettore USB-C |
| **Alimentatore** | USB-C 5V/3A (15W) | Ufficiale RPi consigliato |
| **Dissipatore/Fan** | Attivo consigliato | AI inference genera calore |
| **Cavo Ethernet** | Cat6 (consigliato) | Per primo setup headless via SSH |

### Come si usano microSD e SSD insieme?

> Vedi [docs/SETUP-SPIEGATO.md](docs/SETUP-SPIEGATO.md) per la spiegazione completa con diagrammi.

```
FASE 1 (setup):    microSD 32GB → flash OS, primo boot
FASE 2 (migrazione): sistema copiato su SSD 1TB
FASE 3 (per sempre): microSD = solo firmware boot (~50MB)
                      SSD 1TB = TUTTO (OS, AI, dati, ~990GB liberi)
```

La microSD e' troppo lenta (25 MB/s) e piccola (32GB) per l'AI. L'SSD e' 14x piu' veloce (350 MB/s) e ha lo spazio per i modelli AI (3-5GB ciascuno).

### ATTENZIONE: Porta USB-C del Pi 4

```
⚠️  La porta USB-C del Raspberry Pi 4 e' SOLO per ALIMENTAZIONE.
    NON trasferisce dati! Non collegare l'SSD li'!

    L'SSD va collegato a una porta USB 3.0 (BLU):

    ┌──────────────────────────────────────────┐
    │  [USB 2.0] [USB 2.0]  [USB 3.0] [USB 3.0]  [Ethernet]
    │                         ^^^^^^^^  ^^^^^^^^
    │                         BLU=dati  BLU=dati
    │  [USB-C ⚡]
    │   ^^^^^^^^
    │   SOLO corrente!
    └──────────────────────────────────────────┘

    Se il tuo SSD ha connettore USB-C, ti serve un adattatore
    USB-C (femmina) → USB-A (maschio), USB 3.0.  Costa ~5€.
```

### Adapter USB 3.0 Consigliati (UASP)

```
# Se hai un SSD esterno USB-C (es. Samsung T7):
- Adattatore USB-C → USB-A 3.0    → ~5€ su Amazon

# Se hai un SSD NVMe M.2 "nudo" e un enclosure:
- Realtek RTL9210B     → Migliore compatibilita' RPi
- JMicron JMS583       → Ottimo, ampiamente testato

# Se hai un SSD SATA 2.5":
- ASMedia ASM1153E     → Standard affidabile
- JMicron JMS578       → Alternativa collaudata

# EVITARE:
- VIA VL716            → Problemi UASP su RPi
- Adapter economici senza chipset noto
```

## Prerequisiti Software

- **Mac** (o PC Linux) con lettore SD e Raspberry Pi Imager
- Connessione internet (Ethernet o WiFi)
- Questo repository clonato **sul Mac** (per gli script Step 0)

> **Non serve** monitor ne' tastiera collegati al Pi. Tutto si fa via SSH dal Mac.

---

## Step 0 - Setup SSH dal Mac

> **Questo e' il primo step da eseguire.** Prepara la microSD sul Mac e configura tutto per gestire il Pi da remoto via SSH senza mai toccare monitor o tastiera.

### 0.1 Flash OS sulla microSD (dal Mac)

1. Scarica e installa [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Inserisci la microSD 32GB nel Mac
3. Apri Raspberry Pi Imager e seleziona:
   - **Device**: Raspberry Pi 4
   - **OS**: Raspberry Pi OS (64-bit) Lite - Bookworm
   - **Storage**: la tua microSD
4. **PRIMA di cliccare Write**, clicca **"Edit Settings"** (o l'icona ⚙):

   **Tab "GENERAL":**

   | Impostazione | Cosa mettere |
   |---|---|
   | Set hostname | `piclaw` |
   | Set username and password | Username: `pi`, Password: *(scegline una sicura e ricordala)* |
   | **Configure wireless LAN** | **Spunta la casella!** |
   | SSID | **Il nome esatto della tua rete WiFi** (es. `Casa-WiFi`) |
   | Password | **La password della tua rete WiFi** |
   | Wireless LAN country | `IT` |
   | Set locale settings | Timezone: `Europe/Rome`, Keyboard: `it` |

   **Tab "SERVICES":**

   | Impostazione | Cosa mettere |
   |---|---|
   | Enable SSH | **Si** - spunta "Use password authentication" |

5. Clicca **Save**, poi **Write** e attendi il completamento

> **Il WiFi si imposta qui**, al punto 4. RPi Imager scrive la configurazione WiFi direttamente sulla microSD cosi' il Pi si connette automaticamente alla tua rete al primo avvio. Non serve cavo Ethernet se configuri il WiFi qui.

### 0.2 Prepara SSH e chiave pubblica (dal Mac)

Dopo il flash, **estrai e reinserisci** la microSD nel Mac. Poi dal terminale Mac:

```bash
# Clona questo repository sul Mac
git clone https://github.com/Andrea0xeth/Raspberry_claw.git
cd Raspberry_claw

# Esegui lo script di preparazione
bash scripts/00-mac-setup/01-prepare-sd-mac.sh
```

Lo script:
- Rileva automaticamente la microSD montata (`/Volumes/bootfs`)
- Crea il file `ssh` per abilitare SSH al primo boot
- Copia la tua chiave pubblica SSH (`~/.ssh/id_ed25519.pub`) sulla SD
- **(Opzionale)** Se non hai configurato il WiFi in RPi Imager (Step 0.1), lo script te lo chiede qui e lo configura sulla microSD
- Espelle la microSD in sicurezza

> **WiFi**: Se lo hai gia' configurato in RPi Imager al punto 0.1, lo script ti chiede comunque ma puoi rispondere `n`. Non serve configurarlo due volte.

### 0.3 Primo boot e connessione

1. **Inserisci** la microSD nel Raspberry Pi 4
2. **Collega** il cavo Ethernet al router (consigliato) oppure usa WiFi se configurato
3. **Collega** l'alimentatore USB-C -- il Pi si accende automaticamente
4. **Attendi 1-2 minuti** per il primo avvio completo

Dal terminale Mac:

```bash
# Metodo 1: Connessione diretta (se il Mac e' sulla stessa rete)
ssh pi@piclaw.local

# Metodo 2: Usa lo script auto-discovery
bash scripts/00-mac-setup/02-connect-ssh.sh

# Metodo 3: Se conosci l'IP del Pi
ssh pi@192.168.1.XXX
```

> **Nota**: Al primo collegamento, il terminale chiedera' di accettare la fingerprint del Pi. Digita `yes`.

### 0.4 Configura SSH per accesso rapido (dal Mac)

Dopo la prima connessione riuscita, configura il Mac per accesso veloce:

```bash
# Dal Mac - configura ~/.ssh/config
bash scripts/00-mac-setup/03-setup-ssh-config.sh
```

D'ora in poi basta digitare:

```bash
ssh piclaw                          # Connetti
ssh piclaw 'uptime'                 # Esegui comando remoto
ssh piclaw 'vcgencmd measure_temp'  # Temperatura CPU
ssh piclaw 'sudo reboot'            # Riavvia il Pi
scp file.txt piclaw:~/              # Copia file sul Pi
rsync -avz ./codice piclaw:~/       # Sync cartella

# Tunnel SSH per accedere alle API dal Mac
ssh -L 3100:localhost:3100 -L 11434:localhost:11434 piclaw
# Poi apri: http://localhost:3100/health
```

### 0.5 Hardening SSH (dal Pi, via SSH)

Una volta connesso al Pi:

```bash
sudo bash /boot/firmware/piclaw-ssh-setup.sh  # Configura chiave SSH
# oppure, se hai clonato il repo sul Pi:
sudo bash scripts/01-os-setup/00-configure-ssh.sh
```

Questo script:
- Configura login con chiave pubblica (senza password)
- Hardening: disabilita root login, limita tentativi
- Configura fail2ban (ban dopo 5 tentativi falliti)
- Aggiunge banner e MOTD con info sistema al login

### 0.6 Trovare il Pi se `piclaw.local` non funziona

```bash
# Dal Mac: cerca Pi via MAC address nella tabella ARP
arp -a | grep -iE 'b8:27:eb|dc:a6:32|d8:3a:dd|e4:5f:01|2c:cf:67'

# Dal Mac: Bonjour discovery
dns-sd -B _ssh._tcp

# Dal Mac: ping broadcast (trova tutti i dispositivi)
ping 224.0.0.1

# Dal router: controlla la pagina DHCP leases

# Dal Pi (se hai monitor temporaneo): 
hostname -I
```

---

## Quick Start

Per chi vuole il setup completo automatizzato:

```bash
# ═══ SUL MAC ═══════════════════════════════════════════
# 1. Flash Raspberry Pi OS 64-bit Lite su microSD con RPi Imager
#    (abilita SSH + imposta user pi nelle impostazioni avanzate)

# 2. Prepara microSD per accesso SSH senza monitor
git clone https://github.com/Andrea0xeth/Raspberry_claw.git
cd Raspberry_claw
bash scripts/00-mac-setup/01-prepare-sd-mac.sh

# 3. Inserisci SD nel Pi, accendi, attendi 2 minuti

# 4. Connetti via SSH
bash scripts/00-mac-setup/02-connect-ssh.sh
# oppure: ssh pi@piclaw.local

# 5. Configura accesso rapido sul Mac (opzionale)
bash scripts/00-mac-setup/03-setup-ssh-config.sh
# D'ora in poi basta: ssh piclaw

# ═══ SUL PI (via SSH) ══════════════════════════════════
# 6. Setup completo (eseguire in ordine)
git clone https://github.com/Andrea0xeth/Raspberry_claw.git
cd Raspberry_claw

sudo bash scripts/01-os-setup/00-configure-ssh.sh    # Hardening SSH
sudo bash scripts/01-os-setup/01-initial-setup.sh     # Setup OS
sudo bash scripts/02-ssd-boot/01-prepare-ssd.sh       # Prepara SSD
# === REBOOT (il Pi riavvia da SSD) ===
sudo bash scripts/02-ssd-boot/02-post-ssd-boot.sh     # Verifica SSD
sudo bash scripts/03-openclaw/01-install-openclaw.sh   # OpenClaw
sudo bash scripts/04-ai-engine/01-install-ollama.sh    # Ollama
sudo bash scripts/04-ai-engine/02-setup-models.sh      # Modelli AI
sudo bash scripts/05-optimization/01-ssd-optimize.sh   # Ottimizzazioni
sudo bash scripts/06-testing/01-run-tests.sh           # Test
```

---

## Step 1 - Installazione OS e Boot da SSD

### 1.1 Flash microSD e Primo Collegamento SSH

> Se hai gia' completato lo [Step 0](#step-0---setup-ssh-dal-mac), la microSD e' gia' pronta e sei connesso via SSH. Passa direttamente al punto 1.2.

Se non hai eseguito lo Step 0:
1. Segui le istruzioni in [Step 0.1](#01-flash-os-sulla-microsd-dal-mac) per flashare la microSD
2. Segui [Step 0.3](#03-primo-boot-e-connessione) per la prima connessione SSH

### 1.2 Setup Base (via SSH dal Mac)

```bash
# Dal Mac: connettiti al Pi
ssh piclaw
# oppure: ssh pi@piclaw.local

# Sul Pi: clona il repository
git clone https://github.com/Andrea0xeth/Raspberry_claw.git
cd Raspberry_claw

# Opzionale: configura e hardening SSH
sudo bash scripts/01-os-setup/00-configure-ssh.sh

# Esegui setup iniziale
sudo bash scripts/01-os-setup/01-initial-setup.sh
```

Lo script `01-initial-setup.sh` esegue:
- Aggiornamento completo del sistema
- Installazione pacchetti essenziali (git, curl, python3, build-essential, etc.)
- Abilitazione interfacce hardware (I2C, SPI, UART, GPIO)
- Configurazione boot USB nel bootloader
- Installazione Node.js 20 LTS
- Installazione Docker CE
- Configurazione swap ottimale per 8GB RAM
- Hardening sicurezza base

### 1.3 Migrazione Boot su SSD

```bash
# Collega SSD USB 3.0 (porta blu)
# Verifica riconoscimento
lsblk
# Dovrebbe mostrare /dev/sda

# Prepara SSD e clona sistema
sudo bash scripts/02-ssd-boot/01-prepare-ssd.sh
```

Lo script:
- Partiziona SSD (boot 512MB + rootfs resto)
- Clona microSD su SSD con rsync
- Aggiorna fstab e cmdline.txt
- Configura boot order: USB first

### 1.4 Boot da SSD

```bash
sudo reboot
# Il Pi ora boota da SSD

# Dopo reboot, verifica e finalizza
sudo bash scripts/02-ssd-boot/02-post-ssd-boot.sh
```

---

## Step 2 - Setup OpenClaw con Accesso Root

```bash
sudo bash scripts/03-openclaw/01-install-openclaw.sh
```

### Cosa viene configurato:

1. **Utente dedicato** `openclaw` con accesso root via sudoers NOPASSWD
2. **Installazione OpenClaw** da repository ufficiale
3. **Systemd service** root-owned con restart automatico
4. **Capabilities** per accesso GPIO/I2C senza limitazioni
5. **Tools estesi**: shell executor, GPIO controller, file manager, network manager
6. **Integrazione Ollama** come backend AI

### Configurazione Sicurezza

```bash
# Sudoers: /etc/sudoers.d/openclaw
openclaw ALL=(ALL) NOPASSWD: ALL

# Capabilities binarie
setcap cap_sys_rawio,cap_sys_admin,cap_net_admin+eip /usr/local/bin/openclaw

# Gruppi utente openclaw
gpio, i2c, spi, dialout, docker, video, audio, plugdev
```

---

## Step 3 - AI Engine con Ollama

```bash
sudo bash scripts/04-ai-engine/01-install-ollama.sh
```

### Configurazione Ollama:

- **Installazione** su SSD: `/data/ollama`
- **Modelli directory**: `/data/ollama/models` (1TB spazio)
- **API endpoint**: `http://localhost:11434`
- **Systemd service** con limiti memoria ottimizzati
- **Variabili ambiente**: OLLAMA_HOST, OLLAMA_MODELS, OLLAMA_NUM_PARALLEL

### Scaricamento Modelli

```bash
sudo bash scripts/04-ai-engine/02-setup-models.sh
```

---

## Step 4 - Modello AI Custom

Il modello custom `piclaw-agent` e' definito in `models/Modelfile.piclaw-agent`:

```
FROM llama3.2:8b-instruct-q4_K_M

SYSTEM """
Sei PiClaw, un agente AI autonomo che opera su Raspberry Pi 4.
Hai accesso COMPLETO al sistema: root/sudo, GPIO, I2C, SPI, rete, file, processi.

CAPACITA':
- Esecuzione comandi shell (bash) con privilegi root
- Controllo GPIO pins (lettura/scrittura digitale, PWM)
- Gestione file e directory (lettura, scrittura, permessi)
- Monitoring sistema (CPU, RAM, temperatura, storage, rete)
- Gestione processi (start, stop, restart servizi)
- Configurazione rete (IP, firewall, DNS)
- Decisioni autonome basate su dati sensori e stato sistema

COMPORTAMENTO:
1. ANALIZZA: raccogli dati sul problema/richiesta
2. PIANIFICA: definisci passi concreti
3. ESEGUI: usa i tool disponibili
4. VERIFICA: controlla il risultato
5. RIPORTA: comunica l'esito

Sii PROATTIVO: se rilevi anomalie (temperatura alta, disco pieno,
batteria bassa, servizio down), agisci autonomamente.
"""

PARAMETER temperature 0.3
PARAMETER num_ctx 4096
PARAMETER num_predict 2048
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.1
```

### Creazione Modello

```bash
ollama create piclaw-agent -f models/Modelfile.piclaw-agent
```

---

## Step 5 - Ottimizzazioni 1TB SSD

```bash
sudo bash scripts/05-optimization/01-ssd-optimize.sh
```

### Ottimizzazioni applicate:

- **fstrim** schedulato (settimanale) per longevita SSD
- **I/O scheduler**: `none` (noop) per NVMe/SSD
- **Swappiness**: ridotta a 10
- **Mount options**: `noatime,nodiratime,discard`
- **tmpfs** per `/tmp` e log volatili
- **Monitoring storage** automatico con alert
- **Log rotation** aggressivo per risparmiare spazio
- **Modelli multipli** Ollama organizzati per dimensione

---

## Step 6 - Test e Validazione

```bash
sudo bash scripts/06-testing/01-run-tests.sh
```

### Test eseguiti:

1. **Hardware**: SSD riconosciuto, UASP attivo, velocita I/O
2. **Boot**: Sistema avviato da SSD, partizioni corrette
3. **OpenClaw**: Servizio attivo, accesso root funzionante
4. **Ollama**: API raggiungibile, modello caricato
5. **AI Decision**: Test decisione autonoma (es. "gestisci batteria bassa")
6. **GPIO**: Lettura/scrittura pin di test
7. **Performance**: Benchmark inference, latenza risposta
8. **Storage**: Spazio disponibile, velocita lettura/scrittura

---

## Troubleshooting

Vedi [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) per la guida completa.

### Problemi Comuni Rapidi

| Problema | Soluzione |
|---|---|
| SSD non riconosciuto | Verificare adapter UASP, provare altra porta USB3 |
| Boot lento da USB | `sudo rpi-eeprom-update -a` per aggiornare firmware |
| Ollama OOM (out of memory) | Usare modello Q4_K_M, aumentare swap |
| OpenClaw permission denied | Verificare sudoers e capabilities |
| GPIO access denied | Aggiungere utente a gruppo `gpio` |
| Temperatura alta | Installare dissipatore attivo, ridurre threads Ollama |

---

## Struttura Progetto

```
Raspberry_claw/
├── README.md                              # Questa guida
├── scripts/
│   ├── 00-mac-setup/                     # ← ESEGUIRE SUL MAC
│   │   ├── 01-prepare-sd-mac.sh          # Prepara microSD con SSH+WiFi+chiave
│   │   ├── 02-connect-ssh.sh             # Auto-discovery e connessione al Pi
│   │   └── 03-setup-ssh-config.sh        # Config ~/.ssh/config per "ssh piclaw"
│   ├── 01-os-setup/                      # ← ESEGUIRE SUL PI (via SSH)
│   │   ├── 00-configure-ssh.sh           # Hardening SSH + fail2ban + MOTD
│   │   └── 01-initial-setup.sh           # Setup iniziale OS
│   ├── 02-ssd-boot/
│   │   ├── 01-prepare-ssd.sh             # Preparazione e clone SSD
│   │   └── 02-post-ssd-boot.sh           # Verifica post-boot SSD
│   ├── 03-openclaw/
│   │   └── 01-install-openclaw.sh        # Installazione OpenClaw
│   ├── 04-ai-engine/
│   │   ├── 01-install-ollama.sh          # Installazione Ollama
│   │   └── 02-setup-models.sh            # Download e setup modelli
│   ├── 05-optimization/
│   │   └── 01-ssd-optimize.sh            # Ottimizzazioni SSD/sistema
│   └── 06-testing/
│       └── 01-run-tests.sh               # Suite di test completa
├── config/
│   ├── systemd/
│   │   ├── openclaw.service              # Service file OpenClaw
│   │   └── ollama.service                # Service file Ollama
│   ├── ollama/
│   │   └── ollama.env                    # Env vars Ollama
│   ├── openclaw/
│   │   ├── openclaw.yaml                 # Config principale OpenClaw
│   │   └── tools.yaml                    # Definizione tools estesi
│   └── sudoers/
│       └── openclaw                      # Sudoers per utente openclaw
├── models/
│   ├── Modelfile.piclaw-agent            # Modello agente decisionale
│   └── Modelfile.piclaw-coder            # Modello assistente codice
├── tools/
│   ├── gpio_controller.py                # Tool GPIO per OpenClaw
│   ├── system_monitor.py                 # Tool monitoring sistema
│   ├── network_manager.py                # Tool gestione rete
│   └── decision_engine.py                # Engine decisionale AI
└── docs/
    ├── SETUP-SPIEGATO.md                 # ⭐ Spiegazione semplice: a cosa servono SD e SSD
    ├── TROUBLESHOOTING.md                # Guida troubleshooting
    ├── HARDWARE-GUIDE.md                 # Guida hardware dettagliata
    └── AI-TUNING.md                      # Guida fine-tuning modello
```

---

## Licenza

MIT License - Vedi [LICENSE](LICENSE) per dettagli.

## Contributi

Pull request benvenute. Per modifiche importanti, apri prima una issue.
