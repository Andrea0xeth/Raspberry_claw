# OpenClaw — 4-agent architecture (English)

Four specialized agents run on the Pi. All post to the **same Discord** thread (username = agent label). The **Orchestrator** runs a **30-minute cycle** that checks the vault and triggers the other three.

## Roles

| Agent   | Port | Role | OPENCLAW_AGENT_ROLE   | OPENCLAW_AGENT_LABEL   |
|---------|------|------|------------------------|-------------------------|
| 1       | 3100 | **Orchestrator** | `orchestrator` | Orchestrator |
| 2       | 3101 | **DeFi Expert**  | `defi-expert`  | DeFi Expert  |
| 3       | 3102 | **Executor**     | `executor`     | Executor     |
| 4       | 3103 | **System Improver** | `system-improver` | System Improver |

## Behaviour

1. **Orchestrator (3100)**  
   - Every **30 minutes**: runs a cycle (vault check + trigger other agents).  
   - Uses **Factor MCP** to check vault `0xbad0d504b0b03443547e65ba9bf5ca47ecf644dc`.  
   - **Calls** the other agents via `call_agent({ port: 3101|3102|3103, message })`.  
   - **Posts to Discord**: cycle start, vault summary, each agent’s result summary, cycle complete.

2. **DeFi Expert (3101)**  
   - **Triggered by** the Orchestrator.  
   - Knows protocols and Factor strategies (canvas, LEND/BORROW/SWAP, etc.).  
   - Given vault + chain + assets, **proposes** a yield-maximizing strategy (no execution, no wallet).  
   - **Posts to Discord**: short strategy summary.

3. **Executor (3102)**  
   - **Triggered by** the Orchestrator.  
   - **Self-manages the vault**: always executes real transactions. Uses factor_simulate_strategy only to validate; then always calls factor_execute_strategy or factor_execute_manager to broadcast. Never simulation-only — always real execution. No human approval required.  
   - Writes as much info as possible: post_to_discord (steps, amounts, tx hashes, outcomes), append_memory with full execution results.

4. **System Improver (3103)**  
   - **Triggered by** the Orchestrator (or can be run on a schedule).  
   - **Full system access**: sudo, systemctl, logs, disk, CPU/memory.  
   - **Manages via OpenClaw CLI** when installed: `openclaw health`, `openclaw status`, `openclaw gateway status`, `openclaw cron list`, `openclaw channels status`, `openclaw logs`, `openclaw doctor` (see skill `openclaw-cli.md`). If the CLI is not installed, uses curl (e.g. `curl http://127.0.0.1:3100/health`) and systemctl for the four agents.  
   - Reads logs, checks overload, suggests or applies improvements.  
   - **Posts to Discord**: findings and actions.

## Self-managed vault + real execution + verbose logging

- **Executor** always executes real transactions (simulate to validate, then always broadcast). No human approval. On the Pi, Factor MCP must have `"simulationMode": false` in `~/.factor-mcp/config.json` so transactions are broadcast. All agents write as much info as they can: detailed Discord posts (vault state, strategy steps, amounts, tx hashes, errors), append_memory for outcomes and decisions.

## Discord

- All four use the **same webhook** and **thread** (see `DISCORD_WEBHOOK_URL`, `DISCORD_THREAD_ID` in `index.js`).  
- Each message is sent with **username** = `OPENCLAW_AGENT_LABEL` (Orchestrator, DeFi Expert, Executor, System Improver).  
- Every `/chat` response is also posted to Discord (excerpt); errors are posted as well.  
- Tools: **`post_to_discord({ message })`** available to all agents.

## Deployment (Pi)

- **Agent 1**: `openclaw.service` — root `/opt/openclaw`, role `orchestrator`, label `Orchestrator`.  
- **Agent 2**: `openclaw-agent2.service` — root `/opt/openclaw-agent2`, role `defi-expert`, label `DeFi Expert`.  
- **Agent 3**: `openclaw-agent3.service` — root `/opt/openclaw-agent3`, port 3102, role `executor`, label `Executor`, `FACTOR_MCP_PATH=/opt/openclaw/factor-mcp/dist/index.js`.  
- **Agent 4**: `openclaw-agent4.service` — root `/opt/openclaw-agent4`, port 3103, role `system-improver`, label `System Improver`.

Create dirs (e.g. for agent3/4):

```bash
sudo mkdir -p /opt/openclaw-agent3/skills /opt/openclaw-agent3/logs
sudo mkdir -p /opt/openclaw-agent4/skills /opt/openclaw-agent4/logs
# Copy config (OpenRouter key, .ai_provider, .openrouter_model) from main or agent2
sudo cp /opt/openclaw/.openrouter_key /opt/openclaw/.ai_provider /opt/openclaw/.openrouter_model /opt/openclaw-agent3/
sudo cp /opt/openclaw/.openrouter_key /opt/openclaw/.ai_provider /opt/openclaw/.openrouter_model /opt/openclaw-agent4/
sudo chown -R openclaw:openclaw /opt/openclaw-agent3 /opt/openclaw-agent4
```

Install units, reload, enable, start:

```bash
sudo cp openclaw-agent3.service openclaw-agent4.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable openclaw-agent3 openclaw-agent4
sudo systemctl start openclaw-agent3 openclaw-agent4
```

Update orchestrator and agent2 to use role/label (if not already):

```bash
# In openclaw.service: Environment=OPENCLAW_AGENT_ROLE=orchestrator, OPENCLAW_AGENT_LABEL=Orchestrator
# In openclaw-agent2.service: Environment=OPENCLAW_AGENT_ROLE=defi-expert, OPENCLAW_AGENT_LABEL=DeFi Expert
sudo systemctl daemon-reload
sudo systemctl restart openclaw openclaw-agent2
```

## Manual trigger (orchestrator cycle)

```bash
curl -s -X POST http://localhost:3100/cron/orchestrate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

(If `CRON_SECRET` is not set, the endpoint accepts requests without auth.)
