# PiClaw - Guida Hardware Dettagliata

## Raspberry Pi 4 Model B - Specifiche

| Specifica | Dettaglio |
|---|---|
| **SoC** | Broadcom BCM2711 |
| **CPU** | Quad-core Cortex-A72 (ARM v8) 64-bit @ 1.8 GHz |
| **RAM** | 4 GB LPDDR4-3200 SDRAM |
| **GPU** | VideoCore VI (OpenGL ES 3.1, Vulkan 1.0) |
| **USB** | 2x USB 3.0, 2x USB 2.0 |
| **Ethernet** | Gigabit Ethernet (reale, non via USB) |
| **WiFi** | 802.11ac dual-band |
| **Bluetooth** | 5.0, BLE |
| **GPIO** | 40 pin header (26 GPIO) |
| **Video** | 2x micro-HDMI (4K@60fps) |
| **Alimentazione** | USB-C 5V/3A |

## GPIO Pinout (BCM)

```
                    3.3V [1]  [2]  5V
             GPIO2 (SDA1) [3]  [4]  5V
             GPIO3 (SCL1) [5]  [6]  GND
                   GPIO4  [7]  [8]  GPIO14 (TXD)
                     GND  [9]  [10] GPIO15 (RXD)
                  GPIO17  [11] [12] GPIO18 (PWM0)
                  GPIO27  [13] [14] GND
                  GPIO22  [15] [16] GPIO23
                    3.3V  [17] [18] GPIO24
          GPIO10 (MOSI)  [19] [20] GND
           GPIO9 (MISO)  [21] [22] GPIO25
          GPIO11 (SCLK)  [23] [24] GPIO8 (CE0)
                     GND  [25] [26] GPIO7 (CE1)
          GPIO0 (ID_SD)  [27] [28] GPIO1 (ID_SC)
                   GPIO5  [29] [30] GND
                   GPIO6  [31] [32] GPIO12 (PWM0)
            GPIO13 (PWM1) [33] [34] GND
            GPIO19 (PWM1) [35] [36] GPIO16
                  GPIO26  [37] [38] GPIO20
                     GND  [39] [40] GPIO21
```

### Pin Funzione Speciale

| Funzione | Pin BCM | Pin Fisico | Note |
|---|---|---|---|
| **I2C1 SDA** | GPIO2 | 3 | Bus I2C per sensori |
| **I2C1 SCL** | GPIO3 | 5 | |
| **SPI0 MOSI** | GPIO10 | 19 | SPI bus 0 |
| **SPI0 MISO** | GPIO9 | 21 | |
| **SPI0 SCLK** | GPIO11 | 23 | |
| **SPI0 CE0** | GPIO8 | 24 | Chip enable 0 |
| **SPI0 CE1** | GPIO7 | 26 | Chip enable 1 |
| **UART TXD** | GPIO14 | 8 | Seriale |
| **UART RXD** | GPIO15 | 10 | |
| **PWM0** | GPIO12/18 | 32/12 | Hardware PWM |
| **PWM1** | GPIO13/19 | 33/35 | Hardware PWM |

## Adapter SSD USB 3.0 Consigliati

### Per NVMe (M.2 NVMe -> USB 3.x)

| Prodotto | Chipset | UASP | Note |
|---|---|---|---|
| **Sabrent EC-SNVE** | RTL9210B | Si' | Migliore per RPi |
| **UGREEN CM400** | JMS583 | Si' | Ottimo rapporto prezzo |
| **SSK SE100** | RTL9210 | Si' | Compatto |
| **Argon ONE M.2** | JMS583 | Si' | Case integrato RPi |

### Per SATA (2.5" SATA -> USB 3.0)

| Prodotto | Chipset | UASP | Note |
|---|---|---|---|
| **StarTech USB3S2SAT3CB** | ASM1153E | Si' | Affidabile |
| **Sabrent EC-SSHD** | JMS578 | Si' | Economico |
| **UGREEN 20953** | ASM1153E | Si' | Buon cavo |

### Chipset da EVITARE

- **VIA VL716** - Problemi UASP su Raspberry Pi
- **JMicron JMS567** - Vecchio, instabile
- Adapter generici senza chipset dichiarato

## SSD Consigliati (1TB)

### NVMe

| SSD | Interfaccia | Lettura | Scrittura | Note |
|---|---|---|---|---|
| **Samsung 980** | PCIe 3.0 x4 | 3500 MB/s | 3000 MB/s | Ottimo, limitato da USB3 |
| **WD SN770** | PCIe 4.0 x4 | 5150 MB/s | 4900 MB/s | Ottimo ma overkill per USB3 |
| **Crucial P3** | PCIe 3.0 x4 | 3500 MB/s | 3000 MB/s | Buon prezzo |
| **Kingston NV2** | PCIe 4.0 x4 | 3500 MB/s | 2100 MB/s | Economico |

### SATA 2.5"

| SSD | Interfaccia | Lettura | Scrittura | Note |
|---|---|---|---|---|
| **Samsung 870 EVO** | SATA III | 560 MB/s | 530 MB/s | Top SATA |
| **Crucial MX500** | SATA III | 560 MB/s | 510 MB/s | Affidabile |
| **WD Blue SA510** | SATA III | 560 MB/s | 530 MB/s | Buon prezzo |

> **Nota**: Su USB 3.0 del RPi4, la velocita' massima reale e' ~350-400 MB/s, quindi anche un SATA e' sufficiente.

## Alimentazione

### Requisiti

- **Minimo**: 5V / 3A (15W) - alimentatore USB-C ufficiale
- **Consigliato**: 5.1V / 3A con cavo di qualita'
- **Con SSD NVMe**: assicurarsi che l'alimentatore regga il carico aggiuntivo (~2-5W)

### Problemi di alimentazione

```bash
# Verifica stato alimentazione
vcgencmd get_throttled

# Interpretazione:
# Bit 0: Under-voltage rilevato
# Bit 1: Frequenza CPU limitata
# Bit 2: Attualmente throttling
# Bit 3: Limite temperatura soft
# Bit 16: Under-voltage storicamente
# Bit 17: Frequenza CPU limitata storicamente
# Bit 18: Throttling storico
# Bit 19: Limite temperatura soft storico

# 0x0 = Tutto OK
# 0x50005 = Under-voltage (serve alimentatore migliore)
```

## Raffreddamento

Per AI inference (Ollama), il Pi genera calore significativo. Consigliato:

1. **Dissipatore passivo** su CPU, RAM e USB controller
2. **Ventola attiva** 5V controllabile via GPIO (opzionale)
3. **Case ventilato** (es. Argon ONE, Flirc)

### Esempio ventola GPIO-controllata

```python
from gpiozero import Fan
from time import sleep

# Ventola su GPIO 14, attiva sopra 65°C
fan = Fan(14)

while True:
    with open('/sys/class/thermal/thermal_zone0/temp') as f:
        temp = int(f.read()) / 1000
    
    if temp > 65:
        fan.on()
    elif temp < 55:
        fan.off()
    
    sleep(10)
```

## Schema Connessioni

```
┌─────────────────────────────────────────────┐
│              RASPBERRY PI 4 4GB              │
│                                              │
│  microSD ─── Boot firmware                   │
│                                              │
│  USB 3.0 ─── [Adapter UASP] ─── NVMe 1TB   │
│  (porta blu)                     (SSD)       │
│                                              │
│  USB 3.0 ─── (disponibile per altri device)  │
│  (porta blu)                                 │
│                                              │
│  USB 2.0 ─── Tastiera/Mouse (setup)         │
│  USB 2.0 ─── (disponibile)                  │
│                                              │
│  Ethernet ─── Router/Switch (Gigabit)        │
│                                              │
│  GPIO ─── Sensori, LED, Relay, etc.          │
│                                              │
│  USB-C ─── Alimentatore 5V/3A               │
└─────────────────────────────────────────────┘
```
