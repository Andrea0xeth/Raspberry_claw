# Skill: OpenClaw CLI – manage gateway, cron, channels, health

Reference: [OpenClaw CLI](https://docs.openclaw.ai/cli). Use this when the **OpenClaw CLI** is installed on the Pi (`which openclaw` or `openclaw --version`). You run commands via the **shell** tool. If the CLI is not installed, use **curl** to our agent HTTP APIs and **systemctl** for our services (see pi-commands.md).

---

## When to use CLI vs our agents

- **Our 4 agents** (this setup): Express servers on ports 3100–3103. Manage with: `curl http://127.0.0.1:3100/health`, `systemctl status openclaw openclaw-agent2 openclaw-agent3 openclaw-agent4`, `journalctl -u openclaw -n 50`.
- **Official OpenClaw Gateway** (if installed): single Gateway process, often port 18789. Manage with: `openclaw gateway status`, `openclaw health`, `openclaw cron list`, `openclaw channels status`.

If both exist, use the CLI for the Gateway and curl/systemctl for our 4 agents.

---

## OpenClaw CLI – essential commands

Run as the user that runs the gateway (e.g. `openclaw` or `pi`). Use `[TOOL_CALL:shell:{"command":"openclaw ..."}]`.

### Health and status

- `openclaw health` — Gateway health (optional: `--json`, `--timeout <ms>`).
- `openclaw status` — Linked sessions, recent recipients. Use `--deep` to probe channels, `--all` for full diagnosis.
- `openclaw status --usage` — Model provider usage/quota when available.

### Gateway (service)

- `openclaw gateway status` — Probes Gateway RPC; shows config path and probe URL. Use `--no-probe` to skip probe, `--json` for scripting.
- `openclaw gateway start` | `stop` | `restart` — Service control.
- `openclaw gateway install` | `uninstall` — Install/remove the Gateway service (launchd/systemd).

### Cron (scheduled jobs)

- `openclaw cron status` — Cron subsystem status.
- `openclaw cron list` — List scheduled jobs (use `--all` to include disabled; `--json` for raw).
- `openclaw cron add` — Add job (needs `--name`, one of `--at` | `--every` | `--cron`, and one of `--system-event` | `--message`).
- `openclaw cron edit <id>` — Patch a job.
- `openclaw cron rm <id>` — Remove a job.
- `openclaw cron enable <id>` | `openclaw cron disable <id>`.
- `openclaw cron runs --id <id>` — Recent runs for a job.
- `openclaw cron run <id>` — Run a job once (optional `--force`).

### Channels (WhatsApp, Telegram, Discord, etc.)

- `openclaw channels list` — Configured channels and auth (use `--no-usage` to skip quota).
- `openclaw channels status` — Channel health; use `--probe` for extra checks.
- `openclaw channels logs` — Recent channel logs (`--channel <name>`, `--lines 200`).

### Logs and doctor

- `openclaw logs` — Tail Gateway file logs (e.g. `openclaw logs --follow`, `openclaw logs --limit 200`, `--json`).
- `openclaw doctor` — Health checks and quick fixes (config, gateway, legacy). Use `--deep` to scan for extra gateway installs, `--yes` for non-interactive.

### Memory (vector search over MEMORY.md + memory/*.md)

- `openclaw memory status` — Index stats.
- `openclaw memory index` — Reindex.
- `openclaw memory search "<query>"` — Semantic search.

### System (heartbeat, events)

- `openclaw system heartbeat last|enable|disable` — Heartbeat controls (Gateway RPC).
- `openclaw system event --text "<text>"` — Enqueue event; use `--mode next-heartbeat` to deliver on next heartbeat.

### Config

- `openclaw config get <path>` — Get config value (dot path).
- `openclaw config set <path> <value>` — Set value.
- Config file: `~/.openclaw/openclaw.json` (or path shown by `openclaw gateway status`).

### Global flags (useful in shell)

- `--json` — Machine-readable output.
- `--no-color` — No ANSI colors.
- `--dev` — Isolate state under `~/.openclaw-dev`.
- `--profile <name>` — Isolate state under `~/.openclaw-<name>`.

---

## Our 4-agent stack (no OpenClaw Gateway)

When managing **this** setup (Raspberry_claw agents on 3100–3103):

1. **Health**: `curl -s http://127.0.0.1:3100/health` (and 3101, 3102, 3103).
2. **Heartbeat**: `curl -s http://127.0.0.1:3100/heartbeat` (GET) or POST with checklist.
3. **Cron**: Our cron runs inside each process (see cron-jobs.js); no `openclaw cron` for these. To trigger: `curl -s -X POST http://127.0.0.1:3100/cron/orchestrate -H "Content-Type: application/json"` (and optional `Authorization: Bearer CRON_SECRET`).
4. **Services**: `sudo systemctl status openclaw openclaw-agent2 openclaw-agent3 openclaw-agent4`, `sudo systemctl restart openclaw openclaw-agent2 openclaw-agent3 openclaw-agent4`.
5. **Logs**: `journalctl -u openclaw -n 100 --no-pager` (and `-u openclaw-agent2`, etc.).

Use the **OpenClaw CLI** when the user has installed it (e.g. for a separate Gateway or for memory/channels tied to that install). Use **curl + systemctl** for our four agents.
