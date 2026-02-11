# Dashboard: agent activity, logs, and Pi files

The PiClaw dashboard (port 3201) shows **Agents**, **Chat**, **Logs**, and **Files**. Everything that happens in the agents and on the Pi can be exposed there.

## What is exposed

| Tab | Source | Description |
|-----|--------|-------------|
| **Agents** | `/agent/messages` | Supervisor and worker activity from the journal (delegations, cycle summaries, errors). Polled every 3s. |
| **Chat** | `/chat` (POST) | User chat with the main agent. |
| **Logs** | `/logs` | Unified log: today’s agent journal (`.jsonl`) + `agent.log`. Replaces the previous shell tail. |
| **Files** | `/pi/files`, `/pi/file` | Browse Pi filesystem (read-only) under `/opt/openclaw`, `/data`, `/home/openclaw`, `/home/pi`. Like viewing the Pi as a repo. |

## Backend (OpenClaw app)

- **dashboard-routes.js** (ESM) in `/opt/openclaw/src/`:
  - `GET /agent/messages?since=N` — messages from journal (ids > N).
  - `GET /logs?journal=80&agentLog=200` — merged journal + agent.log.
  - `GET /pi/files?path=...` — list directory (allowed roots only).
  - `GET /pi/file?path=...` — read file content (max 1MB, allowed roots only).
- **index.js** loads it with ESM: `await import("dashboard-routes.js")` then `registerDashboardRoutes(app)`.

## Dashboard (dashboard.mjs)

- **Logs**: `/api/logs` now proxies to OpenClaw `GET /logs` (unified).
- **Files tab**: path input + “Go” lists entries; click a dir to go in, click a file to show content in the panel.
- **Agents**: `/api/agent-messages` proxies to `GET /agent/messages` (populated from journal).

## Apply / update

1. **Backend** (once): copy `scripts/openclaw-factor/dashboard-routes.js` to `/opt/openclaw/src/` and patch `index.js` (see `patch-dashboard-routes.sh`; use ESM `await import(...)` not `require`).
2. **Dashboard** (once): run `node scripts/openclaw-factor/patch-dashboard-apply.mjs` on the Pi (patches `dashboard.mjs` for Files tab and unified logs).
3. Restart: `sudo systemctl restart openclaw piclaw-dashboard`.

## Allowed file roots

- `/opt/openclaw`
- `/data`
- `/home/openclaw`
- `/home/pi`

Paths outside these are rejected with 403.
