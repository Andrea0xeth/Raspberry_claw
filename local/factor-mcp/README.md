# Factor MCP — copia locale (non in git)

Copia qui config e wallet da `~/.factor-mcp/` per averli nel progetto in locale.

```bash
# Da eseguire nella root del repo (Raspberry_claw)
mkdir -p local/factor-mcp/wallets
cp ~/.factor-mcp/config.json local/factor-mcp/ 2>/dev/null || true
cp ~/.factor-mcp/wallets/*.json local/factor-mcp/wallets/ 2>/dev/null || true
```

- `config.json` e `wallets/` sono in **.gitignore** (contengono chiavi e dati sensibili).
- Per ripristinare sul Pi o su un’altra macchina: copia il contenuto di questa cartella in `~/.factor-mcp/` (o in `/root/.factor-mcp/` sul Pi se i servizi girano come root).
