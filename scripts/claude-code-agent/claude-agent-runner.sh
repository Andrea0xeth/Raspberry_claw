#!/bin/bash
###############################################################################
# claude-agent-runner.sh
# Wrapper per Claude Code CLI in modalità headless su Raspberry Pi
# Uso: ./claude-agent-runner.sh [heartbeat|morning|custom "prompt"]
# Cron: */30 * * * * user /path/to/claude-agent-runner.sh heartbeat
###############################################################################
set -euo pipefail

AGENT_ROOT="${CLAUDE_AGENT_ROOT:-$HOME/.claude-code-agent}"
MEMORY_DIR="$AGENT_ROOT/memory"
LOG_DIR="$AGENT_ROOT/logs"
HEARTBEAT_FILE="$AGENT_ROOT/HEARTBEAT.md"
MEMORY_FILE="$AGENT_ROOT/MEMORY.md"
DATE=$(date +%Y-%m-%d)
DATE_LOG=$(date +%Y%m%d)
CURRENT_MEMORY="$MEMORY_DIR/$DATE.md"
LOG_FILE="$LOG_DIR/${DATE_LOG}.log"
TIMEOUT_SEC="${CLAUDE_TIMEOUT:-300}"

mkdir -p "$MEMORY_DIR" "$LOG_DIR"

# Carica env
[[ -f "$AGENT_ROOT/config.env" ]] && source "$AGENT_ROOT/config.env"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# Istruzioni brevi (contesto viene da --system-prompt-file)
HEARTBEAT_INSTRUCTION="Esegui la checklist da HEARTBEAT. Se nulla richiede azione rispondi esattamente: HEARTBEAT_OK"
MORNING_INSTRUCTION="Report mattutino: riassumi stato sistema (uptime, memoria, disco), eventuali azioni consigliate. Sii conciso."

# Esegui Claude (contesto da file, istruzione breve via -p)
# $1=instruction, $2=include_heartbeat (1=yes, 0=no, default 1)
run_claude() {
    local instruction="$1"
    local use_heartbeat="${2:-1}"
    log "Running Claude Code CLI (timeout ${TIMEOUT_SEC}s)..."
    
    local args=(-p "$instruction" --output-format json)
    [[ -f "$MEMORY_FILE" ]] && args=(--system-prompt-file "$MEMORY_FILE" "${args[@]}")
    [[ -f "$CURRENT_MEMORY" ]] && args=(--append-system-prompt-file "$CURRENT_MEMORY" "${args[@]}")
    [[ "$use_heartbeat" = "1" && -f "$HEARTBEAT_FILE" ]] && args=(--append-system-prompt-file "$HEARTBEAT_FILE" "${args[@]}")
    
    local output
    output=$(timeout "$TIMEOUT_SEC" claude "${args[@]}" 2>>"$LOG_FILE" || true)
    
    if [[ -z "$output" ]]; then
        log "ERROR: No output from Claude"
        return 1
    fi
    
    echo "$output"
    
    # Append a memory giornaliera
    echo -e "\n--- $(date '+%H:%M:%S') ---\n$output" >> "$CURRENT_MEMORY"
    
    # Delivery Telegram (opzionale)
    if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
        local excerpt
        excerpt=$(echo "$output" | head -c 3500 | jq -r '.result // .text // .' 2>/dev/null || echo "$output" | head -c 3500)
        curl -sf -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TELEGRAM_CHAT_ID}" \
            -d "text=🤖 Claude heartbeat: ${excerpt}" \
            >> "$LOG_FILE" 2>&1 || true
    fi
    
    return 0
}

# Main
MODE="${1:-heartbeat}"
shift || true

case "$MODE" in
    heartbeat)
        run_claude "$HEARTBEAT_INSTRUCTION" 1
        ;;
    morning)
        run_claude "$MORNING_INSTRUCTION" 0
        ;;
    custom)
        run_claude "${*:-Fai un check veloce del sistema. Rispondi HEARTBEAT_OK se ok.}" 1
        ;;
    *)
        echo "Usage: $0 {heartbeat|morning|custom \"prompt\"}"
        exit 1
        ;;
esac
