# Heartbeat checklist (System Improver)
# Rotate through these checks 2–4 times per day. If nothing needs action, reply HEARTBEAT_OK.

- Check load average and memory (shell: uptime; free -h)
- Check disk usage (df -h /)
- If OpenClaw CLI is installed: openclaw health or openclaw status; otherwise: curl -s http://127.0.0.1:3100/health for agents 3100–3103
- Check our agent services: systemctl is-active openclaw openclaw-agent2 openclaw-agent3 openclaw-agent4
- Scan recent agent logs for errors (journalctl -u openclaw -n 30 --no-pager, same for openclaw-agent2/3/4)
- If overload or repeated errors, post_to_discord with a short finding
- Otherwise reply exactly HEARTBEAT_OK
