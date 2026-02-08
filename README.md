# Raspberry Claw - Sistema Agente AI Autonomo per Raspberry Pi 4

> **Progetto completo step-by-step**: Raspberry Pi 4 (8GB) + 1TB SSD + OpenClaw + Ollama AI Engine
> per un agente AI autonomo con accesso completo all'hardware.

---

## Indice

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
| **microSD** | 32GB+ Class 10/A2 | Boot firmware + recovery |
| **SSD NVMe/SATA** | 1TB | Samsung 980/870 EVO consigliati |
| **Adapter USB 3.0** | UASP compatibile | RTL9210/JMicron JMS583 chipset |
| **Alimentatore** | USB-C 5V/3A (15W) | Ufficiale RPi consigliato |
| **Dissipatore/Fan** | Attivo consigliato | AI inference genera calore |
| **Cavo Ethernet** | Cat6 (opzionale) | Per setup headless |

### Adapter USB 3.0 Consigliati (UASP)

```
# Chipset raccomandati per NVMe-to-USB3:
- Realtek RTL9210B     → Migliore compatibilità RPi
- JMicron JMS583       → Ottimo, ampiamente testato
- ASMedia ASM2362      → Buono, verificare firmware

# Per SATA-to-USB3:
- ASMedia ASM1153E     → Standard affidabile
- JMicron JMS578       → Alternativa collaudata

# EVITARE:
- VIA VL716            → Problemi UASP su RPi
- Adapter economici senza chipset noto
```

## Prerequisiti Software

- **PC/Mac** con lettore SD e Raspberry Pi Imager
- Accesso SSH o monitor+tastiera per setup iniziale
- Connessione internet (Ethernet o WiFi)
- Questo repository clonato

## Quick Start

Per chi vuole il setup completo automatizzato:

```bash
# 1. Flash Raspberry Pi OS 64-bit Lite su microSD con RPi Imager
# 2. Boot, SSH nel Pi, poi:

git clone https://github.com/YOUR_USER/Raspberry_claw.git
cd Raspberry_claw

# 3. Setup completo (eseguire in ordine)
sudo bash scripts/01-os-setup/01-initial-setup.sh
sudo bash scripts/02-ssd-boot/01-prepare-ssd.sh
# === REBOOT dal SSD ===
sudo bash scripts/02-ssd-boot/02-post-ssd-boot.sh
sudo bash scripts/03-openclaw/01-install-openclaw.sh
sudo bash scripts/04-ai-engine/01-install-ollama.sh
sudo bash scripts/04-ai-engine/02-setup-models.sh
sudo bash scripts/05-optimization/01-ssd-optimize.sh
sudo bash scripts/06-testing/01-run-tests.sh
```

---

## Step 1 - Installazione OS e Boot da SSD

### 1.1 Flash microSD

Su PC/Mac:

1. Scarica [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Seleziona **Raspberry Pi OS (64-bit) Lite** (Bookworm)
3. Configura:
   - Hostname: `piclaw`
   - SSH: Abilita con password o chiave pubblica
   - User: `pi` / password sicura
   - WiFi (opzionale): SSID + password
   - Locale: IT / Timezone Europe/Rome
4. Flash su microSD

### 1.2 Primo Boot e Setup Base

```bash
# SSH nel Pi
ssh pi@piclaw.local
# oppure
ssh pi@<IP_ADDRESS>

# Clona questo repository
git clone https://github.com/YOUR_USER/Raspberry_claw.git
cd Raspberry_claw

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
│   ├── 01-os-setup/
│   │   └── 01-initial-setup.sh           # Setup iniziale OS
│   ├── 02-ssd-boot/
│   │   ├── 01-prepare-ssd.sh             # Preparazione e clone SSD
│   │   └── 02-post-ssd-boot.sh           # Verifica post-boot SSD
│   ├── 03-openclaw/
│   │   └── 01-install-openclaw.sh        # Installazione OpenClaw
│   ├── 04-ai-engine/
│   │   ├── 01-install-ollama.sh          # Installazione Ollama
│   │   └── 02-setup-models.sh           # Download e setup modelli
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
    ├── TROUBLESHOOTING.md                # Guida troubleshooting
    ├── HARDWARE-GUIDE.md                 # Guida hardware dettagliata
    └── AI-TUNING.md                      # Guida fine-tuning modello
```

---

## Licenza

MIT License - Vedi [LICENSE](LICENSE) per dettagli.

## Contributi

Pull request benvenute. Per modifiche importanti, apri prima una issue.
