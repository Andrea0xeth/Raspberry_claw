# PiClaw - Setup Spiegato Semplicemente

## Cosa servono microSD e SSD? Entrambi o basta uno?

### Risposta rapida

**Servono entrambi**, ma dopo il setup iniziale la microSD serve solo come "chiavetta di avvio" (usa meno di 100MB dei 32GB).

### Come funziona il Raspberry Pi 4

Il Pi 4 e' come un PC che ha bisogno di un "disco" da cui partire. Per motivi storici, il Pi cerca prima la microSD. Una volta avviato, puo' usare l'SSD per tutto il resto.

### Il processo in 3 fasi

```
╔══════════════════════════════════════════════════════════════╗
║ FASE 1: INSTALLAZIONE (30 minuti)                           ║
║                                                              ║
║   [Mac/PC]                                                   ║
║      │                                                       ║
║      ▼                                                       ║
║   [microSD 32GB] ← Flash Raspberry Pi OS qui                ║
║      │                                                       ║
║      ▼                                                       ║
║   [Raspberry Pi 4] ← Inserisci la SD, accendi               ║
║      │                                                       ║
║      └──→ Il Pi si accende e parte dalla microSD             ║
║           Connettiti via SSH dal Mac                          ║
║           Installi i pacchetti base                          ║
╚══════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════╗
║ FASE 2: MIGRAZIONE SU SSD (1 ora)                           ║
║                                                              ║
║   [Raspberry Pi 4]                                           ║
║      ├── [microSD 32GB] (il sistema attuale)                 ║
║      └── [SSD 1TB USB] ← collegato alla porta USB 3.0       ║
║                                                              ║
║   Lo script copia TUTTO dalla microSD al SSD:                ║
║      microSD ──rsync──→ SSD                                  ║
║                                                              ║
║   Poi configura il Pi per partire dal SSD al prossimo avvio  ║
╚══════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════╗
║ FASE 3: USO NORMALE (per sempre)                             ║
║                                                              ║
║   [Raspberry Pi 4]                                           ║
║      ├── [microSD 32GB] → solo firmware di boot (~50MB)      ║
║      │                    (puo' restare inserita, non si      ║
║      │                     consuma perche' non scrive)        ║
║      │                                                       ║
║      └── [SSD 1TB USB] → TUTTO gira da qui:                  ║
║              ├── Sistema operativo (~5GB)                    ║
║              ├── OpenClaw agent (~500MB)                     ║
║              ├── Ollama + modelli AI (~3-5GB)                ║
║              ├── Docker (~1-2GB)                             ║
║              ├── Dati, log, documenti RAG                    ║
║              └── ~990GB LIBERI per i tuoi progetti           ║
║                                                              ║
║   Dal Mac:  ssh piclaw  → gestisci tutto via terminale       ║
╚══════════════════════════════════════════════════════════════╝
```

### Perche' non usare solo la microSD?

| | microSD 32GB | SSD 1TB |
|---|---|---|
| **Velocita'** | ~25 MB/s | ~350 MB/s (14x piu' veloce) |
| **Spazio** | 32GB (troppo poco per AI) | 1TB (modelli AI + dati) |
| **Durata** | Si degrada con molte scritture | Progettato per scritture intensive |
| **AI Inference** | Lento, modelli piccoli | Veloce, modelli grandi |

La microSD e' troppo lenta e piccola per far girare Ollama con modelli AI. Solo l'SSD ha lo spazio e la velocita' necessari.

### Perche' non usare solo l'SSD?

Si puo' fare (il Pi 4 supporta boot diretto da USB), ma:
- Richiede aggiornamento firmware EEPROM prima
- Serve comunque la microSD per quel primo aggiornamento
- Tenere la microSD come boot firmware e' piu' affidabile

---

## ATTENZIONE: Il collegamento USB-C

### Porte del Raspberry Pi 4

```
    ┌─────────────────────────────────────────┐
    │            RASPBERRY PI 4               │
    │                                         │
    │  ┌───┐ ┌───┐   ┌───┐ ┌───┐             │
    │  │USB│ │USB│   │USB│ │USB│  ┌────────┐ │
    │  │2.0│ │2.0│   │3.0│ │3.0│  │Ethernet│ │
    │  │   │ │   │   │BLU│ │BLU│  │  RJ45  │ │
    │  └───┘ └───┘   └───┘ └───┘  └────────┘ │
    │                                         │
    │  ┌─────────┐                            │
    │  │ USB-C   │ ⚡ SOLO ALIMENTAZIONE!     │
    │  │ (power) │    NON trasferisce dati    │
    │  └─────────┘                            │
    └─────────────────────────────────────────┘
```

**IMPORTANTE**: La porta USB-C del Pi 4 e' **SOLO per l'alimentazione** (corrente). Non puoi collegarci un disco per i dati!

### Dove collegare l'SSD 1TB

L'SSD va collegato a una delle **porte USB 3.0 (blu)**:

```
    Il tuo SSD 1TB
         │
         │ (cavo USB-C del disco)
         │
    ┌────┴────┐
    │ Adapter │  Se il tuo SSD ha connettore USB-C,
    │ USB-C   │  ti serve un adattatore USB-C → USB-A
    │  to     │  oppure un cavo USB-C a USB-A
    │ USB-A   │
    └────┬────┘
         │
         ▼
    [Porta USB 3.0 BLU del Pi]
```

### Scenari possibili per il tuo SSD "Type C"

**Scenario A: SSD esterno con cavo USB-C**
(es. Samsung T7, SanDisk Extreme)
```
SSD ──USB-C──→ [adattatore C-a-A] ──→ porta USB 3.0 blu del Pi
```
Ti serve: adattatore USB-C femmina → USB-A maschio (~5 euro)

**Scenario B: SSD NVMe in enclosure USB-C**
(es. enclosure M.2 NVMe con uscita USB-C)
```
SSD NVMe in enclosure ──USB-C──→ [adattatore C-a-A] ──→ porta USB 3.0 blu del Pi
```
Ti serve: adattatore USB-C femmina → USB-A maschio

**Scenario C: SSD con cavo USB-C a USB-A incluso**
(alcuni SSD esterni includono entrambi i cavi)
```
SSD ──USB-A──→ porta USB 3.0 blu del Pi (diretto!)
```
Non serve adattatore.

### Cosa comprare se ti manca l'adattatore

Cerca su Amazon: **"adattatore USB-C femmina a USB-A maschio"** (~5-8 euro).
Assicurati che sia **USB 3.0/3.1** (non USB 2.0, sarebbe troppo lento).

---

## Riepilogo: cosa ti serve per partire

| Cosa | Ce l'hai? | Note |
|---|---|---|
| Raspberry Pi 4 (8GB) | ✅ | |
| microSD 32GB | ✅ | Per flash OS iniziale |
| SSD 1TB (USB-C) | ✅ | Per OS + AI + dati |
| Adattatore USB-C → USB-A | ❓ | **Verifica!** Serve se il SSD ha solo USB-C |
| Alimentatore USB-C 5V/3A | ❓ | Per alimentare il Pi |
| Cavo Ethernet | Consigliato | Per primo setup (piu' stabile del WiFi) |
| Mac con lettore SD | ✅ | Per flashare la microSD |
