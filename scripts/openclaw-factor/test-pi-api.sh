#!/usr/bin/env bash
###############################################################################
# test-pi-api.sh
# Run OpenClaw + Factor API tests against the Pi (localhost:3100 on the Pi).
# Usage:
#   On Pi:  bash scripts/openclaw-factor/test-pi-api.sh
#   From Mac:  ssh piclaw 'cd Raspberry_claw && bash scripts/openclaw-factor/test-pi-api.sh'
#   Or:  ssh piclaw 'bash -s' < scripts/openclaw-factor/test-pi-api.sh
###############################################################################
set -euo pipefail

BASE_URL="${OPENCLAW_URL:-http://127.0.0.1:3100}"
PASS=0
FAIL=0

pass() { echo "  [PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "OpenClaw + Factor API tests (BASE_URL=$BASE_URL)"
echo ""

# 1. Health
if curl -sf -o /dev/null "$BASE_URL/health"; then
  pass "GET /health"
else
  fail "GET /health"
fi

# 2. Health body (factorMcp)
HEALTH=$(curl -sf "$BASE_URL/health" 2>/dev/null || echo "{}")
if echo "$HEALTH" | grep -q '"factorMcp":true'; then
  pass "Health factorMcp: true"
else
  fail "Health factorMcp (got: $(echo "$HEALTH" | head -c 120))"
fi

# 3. Factor: get_config
CONFIG=$(curl -sf -X POST "$BASE_URL/tool/factor" -H "Content-Type: application/json" -d '{"tool":"factor_get_config","params":{}}' 2>/dev/null || echo "{}")
if echo "$CONFIG" | grep -q '"chain"'; then
  pass "POST /tool/factor factor_get_config"
else
  fail "POST /tool/factor factor_get_config (got: $(echo "$CONFIG" | head -c 120))"
fi

# 4. Factor: get_owned_vaults
VAULTS=$(curl -sf -X POST "$BASE_URL/tool/factor" -H "Content-Type: application/json" -d '{"tool":"factor_get_owned_vaults","params":{}}' 2>/dev/null || echo "{}")
if echo "$VAULTS" | grep -q '"vaults"'; then
  N=$(echo "$VAULTS" | grep -o '"address":"[^"]*"' | wc -l)
  pass "POST /tool/factor factor_get_owned_vaults (vaults: $N)"
else
  fail "POST /tool/factor factor_get_owned_vaults (got: $(echo "$VAULTS" | head -c 120))"
fi

echo ""
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
