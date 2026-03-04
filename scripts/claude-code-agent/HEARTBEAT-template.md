# Heartbeat checklist — Claude Code Agent su Raspberry Pi

Esegui questi controlli. Se tutto è ok, rispondi **esattamente**: `HEARTBEAT_OK`

1. **Carico sistema:** `uptime` — se load > 4 su Pi 4, segnala
2. **Memoria:** `free -h` — se swap > 80% usato, segnala
3. **Disco:** `df -h /` — se root > 90%, segnala
4. **Servizi:** `systemctl is-active openclaw` — se non active, segnala
5. **Temperatura:** `vcgencmd measure_temp` — se > 75°C, segnala

Se qualcosa richiede attenzione, descrivi il problema e l'azione suggerita.  
Se nulla da fare: `HEARTBEAT_OK`
