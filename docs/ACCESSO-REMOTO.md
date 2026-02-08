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

Il Pi ha un IP locale (192.168.1.x) visibile solo dentro la rete di casa. Da fuori non lo raggiungi. Servono soluzioni.

---

## Soluzione 1: NordVPN Meshnet (CONSIGLIATA - gia' hai NordVPN)

Se hai un abbonamento NordVPN, **Meshnet e' incluso gratis**. Collega i tuoi dispositivi tra loro con una rete privata, senza aprire porte sul router.

### Cos'e' Meshnet

```
Qualsiasi rete                       Casa tua
┌──────────┐                         ┌──────────────┐
│ Mac      │                         │ Raspberry Pi │
│ NordVPN  │ ═══ Meshnet tunnel ═══  │ NordVPN      │
│ Meshnet  │     (criptato, P2P)     │ Meshnet      │
└──────────┘                         └──────────────┘

ssh pi@piclaw.nord  ← funziona da qualsiasi rete!
```

Meshnet **non e' la VPN classica** (quella che ti connette a un server NordVPN per navigare anonimo). Meshnet e' un collegamento **diretto tra i tuoi dispositivi**, come se fossero sulla stessa rete locale. La VPN vera e propria non serve per questo.

### Setup sul Pi (una volta, via SSH dalla rete locale)

```bash
sudo bash scripts/07-remote-access/01-install-nordvpn-meshnet.sh
```

Lo script:
1. Installa NordVPN per Linux ARM64
2. Ti guida nel login con il tuo account NordVPN
3. Attiva Meshnet
4. Configura i permessi per SSH remoto

### Setup sul Mac

1. Apri l'app **NordVPN** che usi gia'
2. Vai in **Impostazioni** (o Preferences)
3. Cerca **Meshnet** e **attivalo**
4. Nella lista Meshnet vedrai il tuo Pi (nome tipo `piclaw.nord`)

Se preferisci da terminale (NordVPN CLI per Mac):
```bash
# Se hai Homebrew:
brew install --cask nordvpn

# Attiva Meshnet:
nordvpn set meshnet on

# Vedi i tuoi dispositivi:
nordvpn meshnet peer list
```

### Connessione dal Mac (da qualsiasi rete)

```bash
# Usa il nome Meshnet del Pi:
ssh pi@piclaw.nord

# Oppure con l'IP Meshnet del Pi (lo trovi con):
nordvpn meshnet peer list
# Es: ssh pi@10.5.0.2
```

Per velocizzare, aggiungi al `~/.ssh/config` del Mac:

```
Host piclaw-remote
    HostName piclaw.nord
    User pi
    ServerAliveInterval 30
    Compression yes
    ForwardAgent yes
```

Poi basta: `ssh piclaw-remote`

### Pro e contro

| Pro | Contro |
|---|---|
| Gia' pagato (incluso in NordVPN) | Serve NordVPN su entrambi i dispositivi |
| Nessuna configurazione router | App NordVPN deve essere aperta sul Mac |
| Criptato end-to-end | |
| Connessione diretta P2P (veloce) | |
| Funziona ovunque (4G, hotel, ufficio) | |
| Nessuna porta esposta su internet | |

---

## Soluzione 2: Port Forwarding sul Router (senza nessun servizio)

Se non vuoi usare nessun software aggiuntivo. Esponi una porta del router e ti connetti con l'IP pubblico di casa.

### Come funziona

```
Qualsiasi rete                       Router di casa
┌──────────┐                         ┌─────────┐       ┌────┐
│ Mac      │ ── ssh porta 2222 ───→  │ Router  │ ───→  │ Pi │
└──────────┘    IP pubblico casa     │ :2222→  │       │:22 │
                (85.42.xxx.xx)       │   :2222 │       └────┘
                                     └─────────┘
```

### Setup sul Pi

```bash
sudo bash scripts/07-remote-access/02-setup-port-forwarding.sh
```

Lo script:
1. Configura SSH su una porta custom (default 2222, non 22 per sicurezza)
2. Hardening aggressivo: solo chiave SSH, no password, no root
3. fail2ban: ban 24h dopo 3 tentativi, 7 giorni per recidivi
4. (Opzionale) DuckDNS: nome fisso tipo `piclaw.duckdns.org` per il tuo IP dinamico

### Configurazione router (manuale, dal browser)

1. Apri `http://192.168.1.1` (o `http://192.168.0.1`) nel browser
2. Cerca: **Port Forwarding** / **Virtual Server** / **NAT** / **Inoltro porte**
3. Crea regola:

| Campo | Valore |
|---|---|
| Porta esterna | `2222` |
| Porta interna | `2222` |
| IP destinazione | IP locale del Pi (es. `192.168.1.50`) |
| Protocollo | TCP |

4. Salva

### Connessione dal Mac

```bash
# Trova il tuo IP pubblico (dal Pi):
curl ifconfig.me
# Es: 85.42.123.45

# Dal Mac, ovunque:
ssh -p 2222 pi@85.42.123.45

# Se hai configurato DuckDNS:
ssh -p 2222 pi@piclaw.duckdns.org
```

### Il problema dell'IP dinamico

L'IP pubblico di casa cambia ogni tanto. Soluzioni:
- **DuckDNS** (lo script lo configura): `piclaw.duckdns.org` punta sempre al tuo IP
- Chiedi al tuo provider un **IP statico** (a volte e' gratis)
- Oppure semplicemente: prima di uscire di casa, controlla l'IP con `curl ifconfig.me`

### Pro e contro

| Pro | Contro |
|---|---|
| Nessun software aggiuntivo | Devi configurare il router |
| Nessun account esterno | IP pubblico cambia (serve DynDNS) |
| Controllo completo | Porta esposta su internet (rischio scan/attacchi) |
| | Non funziona con doppio NAT (router operatore + tuo router) |
| | Alcuni operatori (es. fibra con CGNAT) non hanno IP pubblico |

---

## Quale scegliere?

| Situazione | Soluzione |
|---|---|
| **Hai NordVPN** | **Meshnet** - gia' pagato, facile, sicuro |
| Non vuoi nessun servizio | Port Forwarding + DuckDNS |
| Router operatore non configurabile | **Meshnet** (unica che funziona) |
| Operatore con CGNAT (no IP pubblico) | **Meshnet** (unica che funziona) |
| Vuoi accesso anche dal telefono | **Meshnet** (NordVPN ha app iOS/Android) |

---

## Verifica: il tuo operatore supporta port forwarding?

Non tutti gli operatori danno un IP pubblico. Per verificare:

```bash
# Sul Pi, confronta questi due IP:
# IP che il router vede:
curl -s ifconfig.me

# IP che il router assegna (pagina del router):
# Se sono DIVERSI → sei dietro CGNAT → port forwarding NON funziona
# Se sono UGUALI → port forwarding funziona

# Oppure: se il tuo IP pubblico inizia con 100.64.x.x → CGNAT attivo
```

Se hai CGNAT, l'unica soluzione e' Meshnet (o Tailscale/Cloudflare Tunnel).
