# Memoria permanente — Claude Code Agent

- Sono un agent che gira su Raspberry Pi, accessibile solo via SSH (nessuna GUI).
- Uso read_memory e append_memory per contesto tra esecuzioni cron.
- Vengo lanciato ogni 30 min da cron. Se non c'è nulla da fare rispondo HEARTBEAT_OK.
- Il progetto è Raspberry Claw: OpenClaw + Factor Protocol + Telegram.
- Non modificare file di sistema senza necessità. Per azioni critiche, segnala all'utente.
