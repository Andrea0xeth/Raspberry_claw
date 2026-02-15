# Comandi per il Pi (piclaw)

Da Mac, connessione: `ssh -p 2222 pi@piclaw` (o `ssh piclaw` se hai configurato `~/.ssh/config`).

---

## Connessione

```bash
# Connetti al Pi
ssh -p 2222 pi@piclaw
# oppure (se in ~/.ssh/config)
ssh piclaw

# Esegui un comando senza entrare in sessione
ssh -p 2222 pi@piclaw "uptime"
```

---

## OpenClaw (servizio)

```bash
# Stato
sudo systemctl status openclaw

# Avvia / ferma / riavvia
sudo systemctl start openclaw
sudo systemctl stop openclaw
sudo systemctl restart openclaw

# Verifica che sia attivo
sudo systemctl is-active openclaw

# Log in tempo reale
journalctl -u openclaw -f

# Ultimi N righe
journalctl -u openclaw -n 100 --no-pager

# Cerca in log (es. FACTOR, errore)
journalctl -u openclaw -n 200 --no-pager | grep -i factor
```

---

## Telegram (bridge)

Il bridge inoltra i messaggi Telegram all’agente (`POST /chat`) e invia la risposta in chat. Per riattivarlo:

**1. Sul Pi: copia il bridge e il servizio**

Dopo aver sincronizzato il repo (o da cartella del repo sul Pi):

```bash
# Copia script e unit
sudo cp openclaw/src/telegram-bridge.js /opt/openclaw/src/
sudo cp config/systemd/piclaw-telegram.service /etc/systemd/system/
sudo chown openclaw:openclaw /opt/openclaw/src/telegram-bridge.js
```

**2. Imposta il token del bot**

Crea il bot con [@BotFather](https://t.me/BotFather), poi sul Pi:

```bash
sudo mkdir -p /opt/openclaw/config
echo 'TELEGRAM_BOT_TOKEN=123456:ABC...' | sudo tee /opt/openclaw/config/telegram.env
sudo chown openclaw:openclaw /opt/openclaw/config/telegram.env
sudo chmod 600 /opt/openclaw/config/telegram.env
```

**3. Avvia e abilita il servizio**

```bash
sudo systemctl daemon-reload
sudo systemctl enable piclaw-telegram
sudo systemctl start piclaw-telegram
sudo systemctl status piclaw-telegram
```

Log: `journalctl -u piclaw-telegram -f`

**Ricevere il prezzo BTC ogni 5 min su Telegram:** c’è già un cron che manda il prezzo a Discord. Per riceverlo anche qui, chiedi al bot su Telegram «manda il prezzo BTC qui»: ti dirà il tuo `chat_id`. Poi sul Pi aggiungi in `/opt/openclaw/config/telegram.env` la riga `TELEGRAM_CHAT_ID=IL_TUO_CHAT_ID`, copia il unit aggiornato `openclaw.service` (con `EnvironmentFile=-/opt/openclaw/config/telegram.env`) in `/etc/systemd/system/`, `sudo systemctl daemon-reload` e `sudo systemctl restart openclaw`. Da allora il cron BTC invierà anche a questa chat.

---

## Instagram (webhook in OpenClaw)

L’agente può rispondere ai messaggi DM su Instagram tramite **Instagram Messaging API** (Meta). Il webhook è gestito direttamente da OpenClaw (`GET/POST /webhook/instagram`).

**Requisiti:** account Instagram **Professional** (Business o Creator), app su [developers.facebook.com](https://developers.facebook.com) con permessi `instagram_basic` e `instagram_manage_messages`. Per messaggi da utenti qualsiasi serve **Advanced Access** (App Review).

**1. Crea un’app Meta** e aggiungi il prodotto **Instagram** > Instagram Messaging. Ottieni un **Page Access Token** (o token per l’account Instagram) con permesso di inviare messaggi.

**2. Sul Pi: token di verifica e token di accesso**

```bash
# Scegli una stringa segreta per la verifica webhook (es. una password casuale)
echo 'LA_TUA_STRINGA_VERIFY' | sudo tee /opt/openclaw/.instagram_verify_token
# Incolla il token di accesso Meta (Page/Instagram token)
echo 'EAAxxxx...' | sudo tee /opt/openclaw/.instagram_access_token
sudo chown openclaw:openclaw /opt/openclaw/.instagram_verify_token /opt/openclaw/.instagram_access_token
sudo chmod 600 /opt/openclaw/.instagram_verify_token /opt/openclaw/.instagram_access_token
sudo systemctl restart openclaw
```

**3. Nel pannello Meta:** Webhooks > Configura > URL callback: `https://TUO_DOMINIO/webhook/instagram` (es. `https://piclaw.supasoft.xyz/webhook/instagram` se il tunnel punta alla porta 3100). Token di verifica = la stessa stringa di `.instagram_verify_token`. Sottoscrivi il campo **messages** per Instagram.

**4. Collega** l’account Instagram Professional all’app e abilita la ricezione messaggi. Da quel momento i DM inviati al tuo profilo Instagram vengono inoltrati all’agente e la risposta viene inviata in chat.

---

## API OpenClaw (localhost sul Pi)

```bash
# Health
curl -s http://127.0.0.1:3100/health

# Config Factor MCP
curl -s -X POST http://127.0.0.1:3100/factor -H "Content-Type: application/json" -d '{"tool":"factor_get_config","params":{}}'

# Lista tool Factor
curl -s http://127.0.0.1:3100/factor/tools

# Dashboard (da browser: https://piclaw.supasoft.xyz/dashboard)
curl -sI http://127.0.0.1:3100/dashboard
```

---

## Factor MCP – config e wallet

Config: `/home/openclaw/.factor-mcp/config.json`  
Wallet: `/home/openclaw/.factor-mcp/wallets/`

```bash
# Leggi config (come utente openclaw)
sudo -u openclaw cat /home/openclaw/.factor-mcp/config.json

# Imposta simulationMode = false
sudo -u openclaw node -e '
const fs=require("fs");
const p="/home/openclaw/.factor-mcp/config.json";
let c=JSON.parse(fs.readFileSync(p,"utf8"));
c.simulationMode=false;
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log("OK", c);
'

# Imposta simulationMode = true
sudo -u openclaw node -e '
const fs=require("fs");
const p="/home/openclaw/.factor-mcp/config.json";
let c=JSON.parse(fs.readFileSync(p,"utf8"));
c.simulationMode=true;
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log("OK", c);
'

# Imposta defaultChain (ARBITRUM_ONE | BASE | MAINNET)
sudo -u openclaw node -e '
const fs=require("fs");
const p="/home/openclaw/.factor-mcp/config.json";
let c=JSON.parse(fs.readFileSync(p,"utf8"));
c.defaultChain="ARBITRUM_ONE";
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log("OK", c.defaultChain);
'

# Elenco wallet
sudo -u openclaw ls -la /home/openclaw/.factor-mcp/wallets/
```

Dopo aver cambiato la config, riavvia OpenClaw: `sudo systemctl restart openclaw`

---

## Sudo limitato per openclaw (opzionale)

Per permettere all’agente di riavviare OpenClaw e aggiornare il proprio unit file **senza password** (solo questi comandi):

Sul Pi, dalla cartella del repo (o dopo aver copiato i file):

```bash
sudo bash scripts/openclaw-factor/install-openclaw-sudo.sh
```

Oppure manualmente:

```bash
sudo cp scripts/openclaw-factor/openclaw-sudoers /etc/sudoers.d/openclaw
sudo chmod 440 /etc/sudoers.d/openclaw
```

L’utente `openclaw` potrà eseguire solo: `systemctl start|stop|restart|status openclaw`, `systemctl daemon-reload`, `cp /tmp/openclaw.service.new /etc/systemd/system/openclaw.service`. Per revocare: `sudo rm /etc/sudoers.d/openclaw`.

---

## Deploy da Mac verso Pi

```bash
# Dalla root del repo Raspberry_claw

# Sync cartella openclaw (src, skills, public)
rsync -az -e "ssh -p 2222" openclaw/ pi@piclaw:Raspberry_claw/openclaw/

# Copia in /opt/openclaw e riavvia (include telegram-bridge.js)
ssh -p 2222 pi@piclaw "sudo cp Raspberry_claw/openclaw/src/index.js Raspberry_claw/openclaw/src/dashboard-routes.js Raspberry_claw/openclaw/src/telegram-bridge.js /opt/openclaw/src/ && sudo cp -r Raspberry_claw/openclaw/skills/* /opt/openclaw/skills/ && sudo cp -r Raspberry_claw/openclaw/public/* /opt/openclaw/public/ && sudo chown -R openclaw:openclaw /opt/openclaw/src /opt/openclaw/skills /opt/openclaw/public && sudo systemctl restart openclaw"
```

---

## Cartelle utili sul Pi

| Path | Contenuto |
|------|-----------|
| `/opt/openclaw/` | App OpenClaw (src, skills, public, factor-mcp) |
| `/opt/openclaw/src/index.js` | Entry point |
| `/opt/openclaw/skills/` | Skill .md |
| `/opt/openclaw/public/` | Dashboard HTML |
| `/opt/openclaw/factor-mcp/` | Factor MCP (v1.4) |
| `/home/openclaw/.factor-mcp/` | Config e wallet Factor |
| `/data/logs/openclaw/` | agent.log, error.log |
| `/data/agent-journal/` | Journal chat/tool (per tab Agents) |

---

## Sistema (quick)

```bash
# Temperatura CPU
vcgencmd measure_temp

# Uptime
uptime

# Memoria
free -h

# Disco
df -h / /data

# IP
hostname -I
```
