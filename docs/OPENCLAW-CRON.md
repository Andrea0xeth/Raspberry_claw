# OpenClaw — Cron jobs and heartbeat

## Check on the Pi

On the Pi, **these files did not exist** before this setup:

- `/opt/openclaw/src/cron-jobs.js` — dedicated file for cron job definitions
- `/etc/cron.d/openclaw` — system cron for heartbeat (optional)

After deploy you will have `cron-jobs.js` in the app; the system cron file is optional and can be installed from the repo.

## Structure

### 1. Dedicated cron file: `openclaw/src/cron-jobs.js`

- **CRON_JOBS** — array of job definitions: `id`, `name`, `scheduleMs`, `method`, `path`, `description`, `roles`.
- **startCronJobs({ port, secret, agentRole, log })** — starts in-process intervals that POST to the local endpoints. Only jobs whose `roles` include the current agent are scheduled.

Current jobs:

| id              | schedule   | path                  | roles        |
|-----------------|------------|------------------------|--------------|
| heartbeat       | every 15 m | POST /heartbeat       | all          |
| orchestrate     | every 30 m | POST /cron/orchestrate | orchestrator |
| yield-optimize  | every 60 m | POST /cron/yield-optimize | orchestrator |

**Heartbeat** (OpenClaw-style): each agent runs POST /heartbeat every 15 min. The server reads `OPENCLAW_ROOT/HEARTBEAT.md` and sends it as a checklist; the agent follows it and replies `HEARTBEAT_OK` if nothing needs attention. See [Cron vs Heartbeat](https://docs.openclaw.ai/automation/cron-vs-heartbeat).

**HEARTBEAT.md templates** (per role) live in `openclaw/heartbeat-templates/`. On deploy to Pi, copy the matching file to each agent root as `HEARTBEAT.md` (e.g. `HEARTBEAT-orchestrator.md` → `/opt/openclaw/HEARTBEAT.md`).

### 2. Heartbeat endpoint

- **GET /heartbeat** — returns `{ status: "ok", agent, role, ts }`. Use for health checks or external cron.
- **GET /HEARTBEAT** — same (alias).

External monitors or system cron can call `GET http://127.0.0.1:3100/heartbeat` (or `/HEARTBEAT`) to verify the orchestrator is up.

### 3. System cron on the Pi (optional)

From the repo:

```bash
sudo cp config/cron.d/openclaw /etc/cron.d/openclaw
sudo chmod 644 /etc/cron.d/openclaw
```

This pings `GET http://127.0.0.1:3100/heartbeat` every 5 minutes. It does not trigger the 30-min orchestrate cycle (that runs in-process from `cron-jobs.js`).

## Summary

- **Cron logic**: single file `openclaw/src/cron-jobs.js`.
- **Heartbeat**: GET `/heartbeat` or `/HEARTBEAT` for health.
- **On the Pi**: after deploy, `cron-jobs.js` is present; install `/etc/cron.d/openclaw` only if you want the 5-min heartbeat ping from system cron.
