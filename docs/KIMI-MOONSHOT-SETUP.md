# Kimi (Moonshot API) – setup

When the AI provider is **kimi**, OpenClaw uses the **native Moonshot API**, not OpenRouter.

Reference: [Migrating from OpenAI to Kimi API](https://platform.moonshot.ai/docs/guide/migrating-from-openai-to-kimi#about-api-compatibility)

## 1. Create API key

1. Go to [Moonshot AI Console → API Keys](https://platform.moonshot.ai/console/api-keys).
2. Create an API key and copy it (format like `sk-kimi-...`).
3. Ensure your account has quota / is activated for the model you use (e.g. `kimi-k2.5`).

## 2. Configure on the Pi

```bash
# Write the key (replace with your key from the console)
echo -n "YOUR_MOONSHOT_API_KEY" | sudo tee /opt/openclaw/.kimi_key
sudo chmod 600 /opt/openclaw/.kimi_key

# Use Kimi as provider
echo -n kimi | sudo tee /opt/openclaw/.ai_provider

# Optional: set model (default is kimi-k2.5)
echo -n kimi-k2.5 | sudo tee /opt/openclaw/.kimi_model

sudo systemctl restart openclaw
```

## 3. Endpoint and format

- **Base URL:** `https://api.moonshot.ai/v1`
- **Chat:** `POST https://api.moonshot.ai/v1/chat/completions`
- **Auth:** `Authorization: Bearer YOUR_API_KEY`
- **Body:** OpenAI-compatible (`model`, `messages`, `temperature` 0–1, `max_completion_tokens`).

If you get **401 Invalid Authentication**:

- **Use the international platform:** Keys must be created at **https://platform.moonshot.ai/console/api-keys**. Keys from the Chinese site (**platform.moonshot.cn**) do not work with `api.moonshot.ai`.
- Create a new API key, ensure your account has balance, and test with: `curl -s "https://api.moonshot.ai/v1/users/me/balance" -H "Authorization: Bearer YOUR_KEY"` (should return balance, not an error).
- Revoke and replace the key if you ever exposed it (e.g. in a chat log).

---

## Subscription “Moderato” (quota mensile) vs Open Platform

La **subscription Moderato** (quota che si resetta ogni mese, rinnovo automatico) può essere di due tipi:

| Prodotto | Dove | Uso con OpenClaw |
|----------|------|------------------|
| **Kimi Code / Kimi app** | kimi.com, code.kimi.com | Le API key generate qui (es. da “Kimi Code” console) **non** funzionano con `api.moonshot.ai`. Sono per OpenCode/Kimi CLI. Vedi [issue #109](https://github.com/MoonshotAI/Kimi-K2/issues/109). |
| **Open Platform** (api.moonshot.ai) | [platform.moonshot.ai](https://platform.moonshot.ai) | È quello che usa OpenClaw. Qui l’uso si paga a **ricarica** (recharge in $), non con la quota “Moderato” dell’app. |

### Come implementare il tuo piano con OpenClaw

1. **Usare l’Open Platform (consigliato per OpenClaw)**  
   - Vai su [platform.moonshot.ai](https://platform.moonshot.ai) → **Recharge** ([console/pay](https://platform.moonshot.ai/console/pay)).  
   - Ricarica almeno **$1** per sbloccare l’API (Tier0); **$10** (Tier1) o **$20** (Tier2) per limiti più comodi (RPM/TPM più alti).  
   - Crea una **API key** in [API Keys](https://platform.moonshot.ai/console/api-keys).  
   - Metti quella key in OpenClaw (es. `/opt/openclaw/.kimi_key` sul Pi).  
   - OpenClaw userà **solo** questa key e l’endpoint `https://api.moonshot.ai/v1/chat/completions` (nessun OpenRouter).

2. **Se hai la subscription Moderato sull’app Kimi**  
   La quota mensile “Moderato” (es. 2048 token, 200 req/h) è legata al prodotto **Kimi app/Code**, non all’Open Platform. Per usare OpenClaw con Kimi serve comunque una key **dell’Open Platform** con ricarica.  
   - Per chiedere se la subscription Moderato può dare credito anche sull’Open Platform: **api-service@moonshot.ai**.

3. **Limiti Open Platform (dopo ricarica)**  
   - [Recharge and Rate Limiting](https://platform.moonshot.ai/docs/pricing/limits): Tier0 $1 → 1 concorrenza, 3 RPM, 500k TPM; Tier1 $10 → 50 conc., 200 RPM, 2M TPM; ecc.  
   - Controllo saldo: `GET https://api.moonshot.ai/v1/users/me/balance` con `Authorization: Bearer YOUR_KEY`.

In sintesi: per **implementare il piano** con OpenClaw fai ricarica su **platform.moonshot.ai**, usa una API key creata lì e configurala in OpenClaw; la subscription Moderato (quota mensile) va verificata se è sull’Open Platform o solo su app/Code, e in caso contattare Moonshot.
