# OpenClaw — più agenti sulla stessa Pi

Puoi far girare **più istanze** di OpenClaw sullo stesso Raspberry Pi, ognuna con **porta**, **configurazione AI** e **skills** propri.

## Come funziona

Ogni istanza usa una **root** diversa (`OPENCLAW_ROOT`): lì legge/scrive chiavi, provider, modello, log e la cartella `skills`. Il **codice** può restare unico in `/opt/openclaw`; le istanze aggiuntive usano solo cartelle dati diverse.

## Variabili per istanza

| Variabile | Descrizione | Default |
|-----------|-------------|--------|
| `OPENCLAW_ROOT` | Cartella dati dell’agente (key, .ai_provider, skills, logs) | `/opt/openclaw` |
| `OPENCLAW_PORT` | Porta HTTP | `3100` |

Opzionali: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `AI_PROVIDER`, `FACTOR_MCP_PATH`, `LOG_DIR` (altrimenti derivati da `OPENCLAW_ROOT`).

## Esempio: 3 agenti

- **Agente 1 (principale):** root `/opt/openclaw`, porta `3100` (come ora).
- **Agente 2:** root `/opt/openclaw-agent2`, porta `3101`.
- **Agente 3:** root `/opt/openclaw-agent3`, porta `3102`.

### 1. Crea le cartelle dati sul Pi

```bash
sudo mkdir -p /opt/openclaw-agent2/skills /opt/openclaw-agent2/logs
sudo mkdir -p /opt/openclaw-agent3/skills /opt/openclaw-agent3/logs
sudo chown -R openclaw:openclaw /opt/openclaw-agent2 /opt/openclaw-agent3
```

(Copia opzionale di skills da agente 1: `sudo cp -r /opt/openclaw/skills/* /opt/openclaw-agent2/skills/`.)

### 2. Configurazione per ogni agente aggiuntivo

Per **agent2** (es. OpenRouter + modello diverso):

```bash
# Chiave OpenRouter (o usa la stessa dell’agente 1)
echo -n "sk-or-v1-..." | sudo tee /opt/openclaw-agent2/.openrouter_key
echo -n "openrouter" | sudo tee /opt/openclaw-agent2/.ai_provider
echo -n "anthropic/claude-sonnet-4.5" | sudo tee /opt/openclaw-agent2/.openrouter_model
sudo chown -R openclaw:openclaw /opt/openclaw-agent2
```

Ripeti per agent3 con path `/opt/openclaw-agent3/`.

### 3. Servizi systemd

**Agente 2** — crea `/etc/systemd/system/openclaw-agent2.service`:

```ini
[Unit]
Description=OpenClaw Agent 2
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/openclaw/src
Environment=OPENCLAW_ROOT=/opt/openclaw-agent2
Environment=OPENCLAW_PORT=3101
ExecStart=/usr/bin/node /opt/openclaw/src/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=openclaw-agent2

[Install]
WantedBy=multi-user.target
```

**Agente 3** — uguale con `OPENCLAW_ROOT=/opt/openclaw-agent3`, `OPENCLAW_PORT=3102`, `SyslogIdentifier=openclaw-agent3` e nome file `openclaw-agent3.service`.

Poi:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-agent2 openclaw-agent3
```

### 4. Verifica

- Agente 1: `curl -s http://localhost:3100/health`
- Agente 2: `curl -s http://localhost:3101/health`
- Agente 3: `curl -s http://localhost:3102/health`

In `health` vedi `openclawRoot` e `aiProvider` per ogni istanza.

## Factor MCP

Se un agente deve usare Factor MCP, in quella root serve una copia di factor-mcp (o un path condiviso). Imposta ad esempio:

`FACTOR_MCP_PATH=/opt/openclaw-agent2/factor-mcp/dist/index.js`

nella Environment del servizio, oppure copia/symlink da `/opt/openclaw/factor-mcp` se va bene condividere lo stesso binario.

## Riassunto

- **Sì, funziona:** puoi lanciare 2 (o più) agenti OpenClaw con configurazioni diverse.
- Ogni istanza: **porta diversa** e **OPENCLAW_ROOT** diversa (key, .ai_provider, .openrouter_model, skills, logs).
- Stesso `index.js` in `/opt/openclaw/src`; le variabili d’ambiente distinguono le istanze.
