# Skill: Raspberry Pi – shell, OS e comandi

You run **on the Pi** as the OpenClaw process (user typically `openclaw`). You have a **shell** tool: use `[TOOL_CALL:shell:{"command":"..."}]` to run bash commands. Optional: `"timeout": 15000` (ms, max 60000). Result: `{ stdout, stderr, code, signal }`. Use it to inspect the system, read logs, check services, disk, memory, temperature, list files, etc. For actions that need **sudo** (e.g. restart OpenClaw, edit system files), the shell runs as a normal user so sudo will fail; in that case run the command yourself via SSH or tell the user the exact command to run.

---

## Shell tool – when to use

- **Status / read-only**: `systemctl status openclaw`, `vcgencmd measure_temp`, `free -h`, `df -h`, `uptime`, `cat /path/to/file`, `ls -la /opt/openclaw`, `tail -n 50 /data/logs/openclaw/agent.log`, `journalctl -u openclaw -n 30 --no-pager`.
- **Your app and Factor**: list skills, read config, check if Factor MCP is up (e.g. curl localhost:3100/health), read journal.
- **Processes**: `ps aux | grep openclaw`, `pgrep -a node`.
- **Network**: `hostname -I`, `ss -tlnp` or `netstat -tlnp` (ports).
- **Packages**: `dpkg -l | grep node`, `node -v`, `npm -v`.
- **Sudo (limited)**: If the Pi admin has installed the openclaw sudoers fragment (`scripts/openclaw-factor/openclaw-sudoers` → `/etc/sudoers.d/openclaw`), you can run **without password**: `sudo systemctl start openclaw`, `sudo systemctl stop openclaw`, `sudo systemctl restart openclaw`, `sudo systemctl status openclaw`, `sudo systemctl daemon-reload`, and `sudo cp /tmp/openclaw.service.new /etc/systemd/system/openclaw.service`. For any other sudo command, you don't have permission — tell the user to run it manually.

---

## OS – Raspberry Pi OS (Debian-based)

- **Users**: `pi` (often SSH), `openclaw` (runs OpenClaw). Home dirs: `/home/pi`, `/home/openclaw`.
- **Paths**: `/opt/openclaw` = app; `/home/openclaw/.factor-mcp` = Factor config and wallets; `/data` = data/logs (e.g. `/data/logs/openclaw`, `/data/agent-journal`).
- **Services**: systemd. List: `systemctl list-units --type=service`; OpenClaw: `openclaw.service`.
- **Logs**: system = `journalctl`; OpenClaw = `/data/logs/openclaw/agent.log`, `error.log`; syslog = `/var/log/syslog` (read if permissions allow).
- **Cron**: user crons in `/var/spool/cron/crontabs/` (root cron in `/etc/crontab` or `/etc/cron.d/`); list with `crontab -l` for current user.
- **Packages**: `apt` (Debian). Check: `apt list --installed 2>/dev/null | grep -i node`.
- **Disks**: `df -h`, `lsblk`. Often root `/` and optionally `/data` (external or second partition).
- **Temperature**: `vcgencmd measure_temp` (Raspberry Pi). Throttling: `vcgencmd get_throttled`.
- **Memory**: `free -h`, `cat /proc/meminfo`.
- **Kernel / release**: `uname -a`, `cat /etc/os-release`.

---

## OpenClaw (servizio)

- Stato: `systemctl status openclaw` (or via shell tool).
- Riavvia (user must run with sudo): `sudo systemctl restart openclaw`.
- Log in tempo reale: `journalctl -u openclaw -f`; ultime righe: `journalctl -u openclaw -n 100 --no-pager`; filtrare: `| grep -i factor`, `| grep -i error`.

---

## API (localhost sul Pi)

- Health: `curl -s http://127.0.0.1:3100/health`
- Factor config: `curl -s -X POST http://127.0.0.1:3100/factor -H "Content-Type: application/json" -d '{"tool":"factor_get_config","params":{}}'`
- Factor tools: `curl -s http://127.0.0.1:3100/factor/tools`
- Dashboard: https://piclaw.supasoft.xyz/dashboard (porta 3100).

---

## Factor MCP – config sul Pi

- Config file: `/home/openclaw/.factor-mcp/config.json`. Wallet dir: `/home/openclaw/.factor-mcp/wallets/`.
- To **read** config from shell: try `cat /home/openclaw/.factor-mcp/config.json` (if your process user can read it).
- **Changing** config (simulationMode, defaultChain) requires editing the file (e.g. with a small script run as `openclaw` or by the user via SSH). After any config change, OpenClaw must be restarted (user runs `sudo systemctl restart openclaw`).
- **simulationMode**: `true` = only simulate tx; `false` = real tx. **defaultChain**: `ARBITRUM_ONE`, `BASE`, `MAINNET`.

---

## Connessione da Mac

- SSH: `ssh -p 2222 pi@piclaw` or `ssh piclaw` (if in `~/.ssh/config`).
- Remote command: `ssh -p 2222 pi@piclaw "comando"`.

---

## Deploy da Mac

From repo root: `rsync -az -e "ssh -p 2222" openclaw/ pi@piclaw:Raspberry_claw/openclaw/` then on the Pi copy into `/opt/openclaw` (src, skills, public) and restart: `sudo systemctl restart openclaw`. Full one-liner in `docs/PI-COMANDI.md`.

---

## Percorsi utili

| Cosa | Path |
|------|------|
| App OpenClaw | `/opt/openclaw/` (src, skills, public, factor-mcp) |
| Config + wallet Factor | `/home/openclaw/.factor-mcp/` |
| Log OpenClaw | `/data/logs/openclaw/` (agent.log, error.log) |
| Journal (tab Agents) | `/data/agent-journal/` |
| Syslog | `/var/log/syslog` |

Use the **shell** tool to run commands that help answer the user (temperature, disk, memory, logs, list files, curl health). For destructive or sudo operations, tell the user exactly what to run on the Pi or via SSH.

**Skills (your knowledge base)**  
- **list_skills**: see which skills you have. Params: `{}` or `{"includeContent":true}` (full text) or `{"previewLines":5}` (first N lines).  
- **add_skill**: create a new skill from content: `{"filename":"name.md","content":"# Title\n\nMarkdown..."}`.  
- **add_skill_from_path**: import a .md file from the Pi. Param `path`: full path to file. Allowed dirs: `/opt/openclaw`, `/data`, `/home/openclaw`, `/home/pi`. Optional `filename` to save as.  
- **add_skill_from_url**: import from a URL (e.g. raw GitHub, docs). Params: `url`, optional `filename`. Max ~150KB, 15s timeout.  
After any add/import, call **reload_skills** so the new skill is used from the next turn.
