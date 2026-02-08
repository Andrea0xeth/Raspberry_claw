# PiClaw - Accesso Remoto da Reti Diverse

Come connettersi al Raspberry Pi quando il Mac e il Pi sono su reti diverse (es. tu al lavoro, Pi a casa).

---

## Il problema

```
Rete A (ufficio/4G/hotel)            Rete B (casa tua)
┌──────────┐                         ┌──────────────┐
│ Mac      │                         │ Raspberry Pi │
│          │ ──── INTERNET ──── X ── │              │
└──────────┘                         └──────────────┘
IP pubblico A                        IP pubblico B
                                     └→ 192.168.1.50 (Pi)
                                        ↑ non raggiungibile
                                          dall'esterno
```

Il Pi ha un IP locale (192.168.1.x) che esiste solo dentro la rete di casa. Da fuori non lo vedi. Serve un "ponte".

---

## Soluzione 1: Tailscale (CONSIGLIATA)

La piu' semplice. Gratuita. Funziona in 5 minuti.

### Cos'e'

Tailscale crea una **rete privata virtuale (VPN) personale** tra i tuoi dispositivi. Mac e Pi si vedono come se fossero sulla stessa rete, ovunque tu sia.

```
Rete A (ufficio)                     Rete B (casa)
┌──────────┐                         ┌──────────────┐
│ Mac      │                         │ Raspberry Pi │
│ Tailscale│ ════ TUNNEL VPN ══════ │ Tailscale    │
│ 100.x.x.1│     (criptato)        │ 100.x.x.2   │
└──────────┘                         └──────────────┘

ssh pi@piclaw  ← funziona da qualsiasi rete!
```

### Setup (una volta sola)

**Sul Pi** (via SSH quando sei sulla stessa rete):

```bash
sudo bash scripts/07-remote-access/01-install-tailscale.sh
```

Ti apre un link nel terminale. Copialo, aprilo nel browser, crea account gratuito (o login con Google/GitHub).

**Sul Mac:**

```bash
bash scripts/07-remote-access/02-install-tailscale-mac.sh
```

Oppure installa manualmente:
- **Homebrew**: `brew install --cask tailscale`
- **App Store**: cerca "Tailscale"
- **Sito**: https://tailscale.com/download/mac

Apri Tailscale dal Mac e fai login con lo **stesso account** usato sul Pi.

### Uso quotidiano

```bash
# Da qualsiasi rete nel mondo:
ssh piclaw-remote

# Oppure:
ssh pi@piclaw

# Verifica dispositivi connessi:
tailscale status

# Test connessione:
tailscale ping piclaw
```

### Costo

**Gratuito** per uso personale. Il piano free include:
- Fino a 100 dispositivi
- Nessun limite di traffico
- SSH integrato
- Tutto criptato end-to-end

### Pro e contro

| Pro | Contro |
|---|---|
| Setup in 5 minuti | Richiede account Tailscale |
| Gratuito | Dipende dai server Tailscale per la coordinazione |
| Funziona ovunque (4G, hotel, ufficio) | Serve internet su entrambi i lati |
| SSH integrato (nemmeno porta 22) | |
| Criptato end-to-end | |
| Nessuna configurazione router | |

---

## Soluzione 2: Port Forwarding sul Router

Se non vuoi usare servizi esterni.

### Cos'e'

Apri la porta 22 (SSH) sul router di casa e la punti verso il Pi. Poi ti connetti con l'IP pubblico di casa.

```
Qualsiasi rete                       Router casa
┌──────────┐                         ┌─────────┐       ┌────┐
│ Mac      │ ── ssh porta 2222 ───→ │ Router  │ ───→  │ Pi │
└──────────┘     IP pubblico casa    │ :2222→  │       │:22 │
                 (es. 85.42.xxx.xx)  │   :22   │       └────┘
                                     └─────────┘
```

### Setup

1. Trova l'IP locale del Pi:
   ```bash
   # Sul Pi:
   hostname -I
   # Es: 192.168.1.50
   ```

2. Entra nel router (browser: `192.168.1.1`, credenziali sotto il router)

3. Cerca "Port Forwarding" o "Virtual Server" o "NAT"

4. Aggiungi regola:
   | Campo | Valore |
   |---|---|
   | Porta esterna | `2222` (NON usare 22, per sicurezza) |
   | Porta interna | `22` |
   | IP interno | `192.168.1.50` (IP del Pi) |
   | Protocollo | TCP |

5. Trova il tuo IP pubblico:
   ```bash
   curl -s ifconfig.me
   # Es: 85.42.123.45
   ```

6. Dal Mac, ovunque tu sia:
   ```bash
   ssh -p 2222 pi@85.42.123.45
   ```

### Il problema dell'IP dinamico

L'IP pubblico di casa cambia periodicamente. Soluzioni:
- **DuckDNS** (gratuito): ti da' un nome tipo `piclaw.duckdns.org`
- **No-IP**: simile, gratuito con limiti
- Controlla se il tuo provider offre **IP statico** (a volte e' gratis, basta chiedere)

### Pro e contro

| Pro | Contro |
|---|---|
| Nessun servizio esterno | Devi configurare il router |
| Controllo completo | IP pubblico cambia (serve DynDNS) |
| | Espone una porta su internet (rischio sicurezza) |
| | Non funziona se il router non supporta port forwarding |
| | Non funziona con doppio NAT (fibra con router operatore) |

---

## Soluzione 3: Cloudflare Tunnel

Alternativa a Tailscale, gratuita, senza aprire porte.

### Setup rapido

```bash
# Sul Pi:
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared

# Login e crea tunnel
cloudflared tunnel login
cloudflared tunnel create piclaw
cloudflared tunnel route dns piclaw piclaw.tuodominio.com

# Configura per SSH
cat > ~/.cloudflared/config.yml << EOF
tunnel: piclaw
credentials-file: /home/pi/.cloudflared/<ID>.json
ingress:
  - hostname: piclaw.tuodominio.com
    service: ssh://localhost:22
  - service: http_status:404
EOF

# Avvia come servizio
sudo cloudflared service install
```

**Richiede**: un dominio personale su Cloudflare (anche gratuito).

---

## Quale scegliere?

| Situazione | Soluzione consigliata |
|---|---|
| Vuoi la cosa piu' semplice | **Tailscale** |
| Non vuoi creare account | Port Forwarding |
| Hai gia' un dominio Cloudflare | Cloudflare Tunnel |
| Sei dietro doppio NAT (router operatore) | **Tailscale** (unica che funziona) |
| Vuoi accesso anche dal telefono | **Tailscale** (ha app iOS/Android) |

**Il mio consiglio: usa Tailscale.** Setup 5 minuti, gratuito, funziona ovunque, sicuro.
