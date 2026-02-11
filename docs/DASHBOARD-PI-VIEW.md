# Dashboard PiClaw — Agents, Chat, Logs, Files

The dashboard is **served by OpenClaw** at **`/dashboard`** on port **3100**. Point the tunnel (e.g. https://piclaw.supasoft.xyz) to the Pi on **port 3100** so the dashboard is at **https://piclaw.supasoft.xyz/dashboard**. Root **`/`** redirects to `/dashboard` when the client accepts HTML.

## Tabs

| Tab | Description |
|-----|--------------|
| **🧠 Agents** | Everything the agent says and thinks: user messages, assistant replies, tool calls (Factor MCP), reasoning. Polled every 3s from `/agent/messages`. |
| **💬 Chat** | Talk to 0xpiclaw.eth: type and Send. Uses `POST /chat`. |
| **📋 Logs** | Unified logs: today’s agent journal (`.jsonl`) + OpenClaw `agent.log` + last 100 lines of `/var/log/syslog`. `GET /logs?journal=80&agentLog=200&syslog=100`. |
| **📁 Files** | Browse the Raspberry Pi filesystem (read-only). Allowed roots: `/opt/openclaw`, `/data`, `/home/openclaw`, `/home/pi`, `/var/log`, and `/` (whole system). |

## Backend (OpenClaw)

- **dashboard-routes.js** in `/opt/openclaw/src/`:
  - `GET /agent/messages?since=N` — messages from `/data/agent-journal/YYYY-MM-DD.jsonl` (chat + tool_call entries).
  - `GET /logs?journal=80&agentLog=200&syslog=100` — journal + agent.log + syslog.
  - `GET /pi/files?path=...` — list directory.
  - `GET /pi/file?path=...` — read file (max 1MB).
- **index.js** registers these routes and serves **`openclaw/public/index.html`** at `/dashboard` and `/`.
- Each chat turn and each Factor tool call is appended to the agent journal so the Agents tab stays up to date.

## Deploy

From the repo (after pulling):

1. Sync openclaw to the Pi and copy to `/opt/openclaw` (skills, src, **public**).
2. Restart OpenClaw: `sudo systemctl restart openclaw`.
3. Point the public URL (e.g. Cloudflare tunnel) to the Pi **port 3100**. If you previously used port 3201 for a separate dashboard service, you can stop it and use only OpenClaw.

## Allowed file roots

- `/opt/openclaw`, `/data`, `/home/openclaw`, `/home/pi`, `/var/log`, `/` (entire filesystem).
