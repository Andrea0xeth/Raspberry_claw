# Heartbeat checklist (Orchestrator)
# Keep small to limit token burn. Empty or comments only = reply HEARTBEAT_OK.

- Check vault 0xbad0d504b0b03443547e65ba9bf5ca47ecf644dc state (factor_get_vault_info) if not done in last 25 min
- If other agents (3101,3102,3103) failed recently, note for next cycle
- If nothing needs attention, reply exactly HEARTBEAT_OK
