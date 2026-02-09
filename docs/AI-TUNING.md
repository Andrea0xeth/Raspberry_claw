# PiClaw - Guida Fine-Tuning Modello AI

## Panoramica

Il modello AI di PiClaw e' basato su Llama 3.2 con un system prompt personalizzato per operazioni autonome su Raspberry Pi. Questa guida spiega come ottimizzare il modello per le tue esigenze specifiche.

## Modelli Disponibili

### Performance su Raspberry Pi 4 (8GB RAM)

| Modello | Dimensione | RAM Richiesta | Tokens/sec | Consigliato |
|---|---|---|---|---|
| `llama3.2:1b-q4_K_M` | ~600 MB | ~2 GB | 10-15 t/s | Risposte veloci |
| `llama3.2:3b-q4_K_M` | ~2 GB | ~3.5 GB | 3-6 t/s | **Default PiClaw** |
| `llama3.2:8b-q4_K_M` | ~4.7 GB | ~6 GB | 1-2 t/s | Massima qualita' |
| `phi3:mini-q4_K_M` | ~2.3 GB | ~3.5 GB | 4-7 t/s | Alternativa |
| `gemma2:2b-q4_K_M` | ~1.6 GB | ~3 GB | 5-8 t/s | Alternativa |

### Scelta del Modello

- **Uso generale (default)**: `llama3.2:3b` - bilanciamento qualita'/velocita'
- **Risposte rapide**: `llama3.2:1b` - per decisioni semplici/monitoring
- **Qualita' massima**: `llama3.2:8b` - per analisi complesse (piu' lento)

## Personalizzazione Modelfile

### Struttura Modelfile

```
FROM <modello_base>
SYSTEM "<system_prompt>"
PARAMETER <parametro> <valore>
TEMPLATE "<template_conversazione>"
```

### Parametri Importanti

| Parametro | Default | Range | Effetto |
|---|---|---|---|
| `temperature` | 0.3 | 0.0-2.0 | Creativita' vs determinismo |
| `num_ctx` | 4096 | 512-8192 | Finestra contesto (piu' = piu' RAM) |
| `num_predict` | 2048 | 128-4096 | Max tokens risposta |
| `top_p` | 0.9 | 0.0-1.0 | Nucleus sampling |
| `top_k` | 40 | 1-100 | Top-K sampling |
| `repeat_penalty` | 1.1 | 1.0-2.0 | Penalita' ripetizioni |

### Temperature Consigliate per Caso d'Uso

```
Decisioni sistema (shutdown, restart):  temperature 0.1  (molto deterministico)
Analisi stato sistema:                  temperature 0.3  (default PiClaw)
Suggerimenti ottimizzazione:            temperature 0.5  (un po' creativo)
Generazione codice:                     temperature 0.2  (preciso)
Conversazione generale:                 temperature 0.7  (naturale)
```

## Creare un Modello Custom

### Esempio: Modello specializzato per domotica

```bash
cat > models/Modelfile.piclaw-domotica << 'EOF'
FROM llama3.2:3b

SYSTEM """Sei PiClaw Domotica, un agente AI specializzato nella gestione di una casa intelligente tramite Raspberry Pi 4.

DISPOSITIVI GESTITI:
- Luci: relay su GPIO 17, 18, 22, 23 (soggiorno, cucina, camera, bagno)
- Sensore temperatura/umidita': DHT22 su GPIO 4
- Sensore movimento: PIR su GPIO 24
- Serratura elettrica: relay su GPIO 25
- Ventilatore: PWM su GPIO 12

REGOLE DOMOTICHE:
1. Temperatura > 28°C → Attiva ventilatore (PWM graduale)
2. Temperatura < 18°C → Avvisa riscaldamento necessario
3. Movimento rilevato + sera (18-06) → Accendi luci soggiorno
4. Nessun movimento per 30 min → Spegni luci non essenziali
5. Comando "buonanotte" → Spegni tutto, attiva serratura

Rispondi sempre con azioni GPIO specifiche nel formato JSON.
"""

PARAMETER temperature 0.2
PARAMETER num_ctx 2048
PARAMETER num_predict 1024
EOF

ollama create piclaw-domotica -f models/Modelfile.piclaw-domotica
```

### Esempio: Modello per server monitoring

```bash
cat > models/Modelfile.piclaw-sysadmin << 'EOF'
FROM llama3.2:3b

SYSTEM """Sei PiClaw SysAdmin, un agente specializzato nel monitoraggio e gestione di server e servizi.

SERVIZI MONITORATI:
- Nginx (web server)
- PostgreSQL (database)
- Redis (cache)
- Docker containers
- Backup automatici

PROTOCOLLO:
1. Controlla salute servizi ogni 5 minuti
2. Se un servizio e' down, tenta restart (max 3 volte)
3. Se restart fallisce, scala la notifica
4. Monitora metriche: latenza, errori 5xx, connessioni attive
5. Gestisci log rotation e pulizia disco

Rispondi con azioni specifiche systemctl e docker.
"""

PARAMETER temperature 0.1
PARAMETER num_ctx 4096
PARAMETER num_predict 2048
EOF

ollama create piclaw-sysadmin -f models/Modelfile.piclaw-sysadmin
```

## Ottimizzazione Context Window

Il `num_ctx` impatta direttamente la RAM utilizzata:

| num_ctx | RAM aggiuntiva (stima) | Caso d'uso |
|---|---|---|
| 512 | ~100 MB | Comandi brevi |
| 2048 | ~400 MB | Conversazioni brevi |
| 4096 | ~800 MB | **Default** - analisi normali |
| 8192 | ~1.6 GB | Analisi complesse con molto contesto |

Per RPi4 8GB con Ollama:
- `num_ctx=4096` lascia ~2-3 GB per OS e servizi
- `num_ctx=2048` per modelli piu' grandi (8b)

## RAG (Retrieval Augmented Generation)

### Setup RAG con documenti locali

PiClaw supporta RAG per arricchire le risposte con documentazione custom.

```bash
# Directory per documenti RAG
mkdir -p /data/rag/documents

# Inserisci documentazione:
# - Manuali hardware
# - Procedure operative
# - Configurazioni di riferimento
# - Note e appunti

# Esempio: documento procedure
cat > /data/rag/documents/procedure-backup.md << 'EOF'
# Procedura Backup Giornaliero
1. Backup database PostgreSQL: pg_dump → /data/backups/
2. Backup configurazioni: /etc → tar.gz
3. Sync su storage remoto: rsync via SSH
4. Verifica integrita' backup
5. Pulizia backup vecchi (> 30 giorni)
EOF
```

### Embedding e ricerca (futuro)

Per implementazione RAG avanzata:

```python
# Esempio concettuale (richiede librerie aggiuntive)
from sentence_transformers import SentenceTransformer
import chromadb

# Modello embedding leggero per ARM
model = SentenceTransformer('all-MiniLM-L6-v2')

# Database vettoriale locale
client = chromadb.PersistentClient(path="/data/rag/chromadb")
collection = client.get_or_create_collection("piclaw_docs")

# Indicizzazione documenti
for doc_path in Path('/data/rag/documents').glob('**/*.md'):
    text = doc_path.read_text()
    embedding = model.encode(text)
    collection.add(
        documents=[text],
        embeddings=[embedding.tolist()],
        ids=[str(doc_path)]
    )
```

## Test e Benchmark

### Benchmark inferenza

```bash
# Test velocita' risposta
time curl -s -X POST http://localhost:11434/api/generate \
    -d '{"model": "piclaw-agent", "prompt": "Analizza stato sistema", "stream": false}' \
    > /dev/null

# Test con metriche
curl -s -X POST http://localhost:11434/api/generate \
    -d '{"model": "piclaw-agent", "prompt": "Rispondi OK", "stream": false}' | \
    jq '{total_duration: .total_duration, eval_count: .eval_count, eval_duration: .eval_duration}'

# Calcolo tokens/sec
# eval_count / (eval_duration / 1e9) = tokens/sec
```

### Test qualita' decisioni

```bash
# Scenario 1: Temperatura alta
python3 tools/decision_engine.py "Temperatura CPU a 82°C. Cosa fare?" --json

# Scenario 2: Disco pieno
python3 tools/decision_engine.py "Disco /data al 95%. Gestisci." --execute --dry-run

# Scenario 3: Servizio down
python3 tools/decision_engine.py "Nginx e' down da 5 minuti." --json

# Scenario 4: Batteria bassa (UPS)
python3 tools/decision_engine.py "Batteria UPS al 5%. Shutdown sicuro." --json
```

## Gestione Modelli Multipli

Con 1TB SSD, puoi mantenere piu' modelli:

```bash
# Lista modelli e spazio
ollama list
du -sh /data/ollama/models/*

# Modelli consigliati da avere installati:
ollama pull llama3.2:1b    # ~600MB - veloce
ollama pull llama3.2:3b    # ~2GB - default
ollama pull codellama:7b   # ~4GB - codice (opzionale)

# Crea varianti custom
ollama create piclaw-agent -f models/Modelfile.piclaw-agent
ollama create piclaw-coder -f models/Modelfile.piclaw-coder

# Switch modello runtime
# Aggiorna in /opt/openclaw/config/.env:
OLLAMA_MODEL=piclaw-agent

# oppure via API:
curl -X POST http://localhost:3100/decide \
    -H "Content-Type: application/json" \
    -d '{"prompt": "test", "model": "piclaw-coder"}'
```

## Consigli di Tuning

1. **Inizia con temperature bassa** (0.1-0.3) per decisioni di sistema
2. **Riduci num_ctx** se la RAM scarseggia
3. **Usa modello 1b** per monitoring proattivo (risposte rapide)
4. **Usa modello 3b** per decisioni complesse
5. **Testa sempre** dopo modifiche al Modelfile
6. **Monitora** RAM e temperature durante inference
7. **Documenta** le personalizzazioni nel Modelfile stesso
