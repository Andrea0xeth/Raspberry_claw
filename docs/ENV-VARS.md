# Environment variables (secrets and config)

**Do not commit real values.** Use environment variables or local files (e.g. `/opt/openclaw/config/telegram.env`) and keep them out of git (see `.gitignore`).

## Agent (openclaw)

| Variable | Description | Where |
|----------|-------------|--------|
| `OPENCLAW_PORT` | HTTP server port (default `3100`) | env |
| `OPENCLAW_ROOT` | Data root (keys, skills, memory; default `/opt/openclaw`) | env |
| `OPENCLAW_AGENT_ROLE` | e.g. `orchestrator` | env |
| `OPENCLAW_AGENT_LABEL` | Display name in Discord etc. | env |
| `DISCORD_WEBHOOK_URL` | Webhook for agent messages (post_to_discord) | env |
| `DISCORD_THREAD_ID` | Discord thread ID for agent messages | env |
| `DISCORD_LOG_WEBHOOK` | Webhook for winston log transport | env |
| `DISCORD_LOG_THREAD_ID` | Thread for log transport | env |
| `CRON_SECRET` | Bearer token for /cron/orchestrate and /cron/yield-optimize | env |
| `OPENROUTER_API_KEY` or `.openrouter_key` | OpenRouter API key | env or file |
| `KIMI_API_KEY` or `.kimi_key` | Kimi (Moonshot) API key | env or file |
| `MINIMAX_API_KEY` or `.minimax_key` | MiniMax API key (optional) | env or file |
| `INSTAGRAM_VERIFY_TOKEN` / `.instagram_verify_token` | Meta webhook verification | env or file |
| `INSTAGRAM_ACCESS_TOKEN` / `.instagram_access_token` | Meta token to send replies | env or file |

## Cron (same process as agent)

| Variable | Description |
|----------|-------------|
| `DISCORD_LOG_WEBHOOK` | Used for Pi system report and BTC price to Discord |
| `DISCORD_LOG_THREAD_ID` or `PI_REPORT_THREAD_ID` | Thread for cron Discord messages |
| `TELEGRAM_BOT_TOKEN` | For BTC price to Telegram (optional) |
| `TELEGRAM_CHAT_ID` | Chat ID to receive BTC cron on Telegram |

## Telegram bridge (piclaw-telegram)

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `OPENCLAW_CHAT_URL` | Default `http://127.0.0.1:3100/chat` |

Set these in the systemd service or in `/opt/openclaw/config/telegram.env` (and load with `EnvironmentFile=-/opt/openclaw/config/telegram.env`).

## Wallet address in prompts

The agent prompts reference a wallet address (e.g. for Factor). That value is **not** a private key; it is a public Ethereum address. For your own deployment you can replace it via config or by editing the prompt in code. Private keys are only in Factor MCP wallet files (e.g. `~/.factor-mcp/wallets/`), which are not in the repo.
