# OpenRouter sul Pi — comandi da eseguire nel terminale del Pi

Sul Raspberry Pi puoi usare **MiniMax** (OAuth o API key) oppure **OpenRouter**. Puoi switchare quando vuoi.

## 1. Connettiti al Pi

```bash
ssh -p 2222 pi@piclaw
```

## 2. Configura la chiave OpenRouter (solo la prima volta)

Crea il file con la tua API key di OpenRouter (la trovi su https://openrouter.ai/keys):

```bash
echo -n "sk-or-v1-TUA_CHIAVE_QUI" | sudo tee /opt/openclaw/.openrouter_key
sudo chown openclaw:openclaw /opt/openclaw/.openrouter_key
sudo chmod 600 /opt/openclaw/.openrouter_key
```

Sostituisci `sk-or-v1-TUA_CHIAVE_QUI` con la chiave reale.

## 3. Passa a OpenRouter

```bash
echo -n "openrouter" | sudo tee /opt/openclaw/.ai_provider
sudo chown openclaw:openclaw /opt/openclaw/.ai_provider
sudo systemctl restart openclaw
```

## 4. Torna a MiniMax (quando vuoi)

```bash
echo -n "minimax" | sudo tee /opt/openclaw/.ai_provider
sudo chown openclaw:openclaw /opt/openclaw/.ai_provider
sudo systemctl restart openclaw
```

## 5. Switchare senza SSH (via API)

- **Leggere provider attuale:**  
  `curl -s http://localhost:3100/api/ai-provider`
- **Passare a OpenRouter:**  
  `curl -s -X POST http://localhost:3100/api/ai-provider -H "Content-Type: application/json" -d '{"provider":"openrouter"}'`
- **Passare a MiniMax:**  
  `curl -s -X POST http://localhost:3100/api/ai-provider -H "Content-Type: application/json" -d '{"provider":"minimax"}'`

Dopo il POST il provider cambia subito (il file `.ai_provider` viene aggiornato); non serve restart.

## Modello OpenRouter (opzionale)

Di default usa `openai/gpt-4o-mini`. Per cambiare modello sul Pi:

```bash
# es. usare un altro modello (variabile d'ambiente)
sudo systemctl edit openclaw
# Aggiungi:
# [Service]
# Environment="OPENROUTER_MODEL=anthropic/claude-3.5-sonnet"
# Poi:
sudo systemctl daemon-reload
sudo systemctl restart openclaw
```

Oppure in `/etc/default/openclaw` (se esiste) o in un file env sotto `/opt/openclaw` caricato dal service.
