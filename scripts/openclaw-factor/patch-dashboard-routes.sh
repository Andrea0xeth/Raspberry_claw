#!/usr/bin/env bash
# Copies dashboard-routes.js to /opt/openclaw/src and patches index.js to register it.
# Run on Pi: sudo bash scripts/openclaw-factor/patch-dashboard-routes.sh
# From repo: dashboard-routes.js must be in scripts/openclaw-factor/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEST_DIR="${DEST_DIR:-/opt/openclaw/src}"
INDEX_JS="${DEST_DIR}/index.js"
ROUTES_JS="${DEST_DIR}/dashboard-routes.js"

if [ ! -f "$INDEX_JS" ]; then
  echo "Error: $INDEX_JS not found. Set DEST_DIR or run from Pi with OpenClaw installed."
  exit 1
fi

# Copy dashboard-routes.js
cp "$SCRIPT_DIR/dashboard-routes.js" "$ROUTES_JS"
chown openclaw:openclaw "$ROUTES_JS" 2>/dev/null || true
echo "[OK] Copied dashboard-routes.js to $ROUTES_JS"

# Already patched?
if grep -q "registerDashboardRoutes" "$INDEX_JS"; then
  echo "[OK] index.js already registers dashboard routes."
  exit 0
fi

# Insert before app.listen (use a line that is unique)
# We need: const { registerDashboardRoutes } = require("./dashboard-routes.js");\nregisterDashboardRoutes(app);\n\n
BACKUP="${INDEX_JS}.bak.dashboard-$(date +%Y%m%d%H%M%S)"
cp -a "$INDEX_JS" "$BACKUP"

# ESM: add fileURLToPath import and await import() before app.listen (index.js is ESM)
grep -q 'fileURLToPath' "$INDEX_JS" || sed -i 's|import cron from "node-cron";|import cron from "node-cron";\nimport { fileURLToPath } from "url";|' "$INDEX_JS"
grep -q 'registerDashboardRoutes' "$INDEX_JS" || sed -i '/^app.listen(CONFIG.port,/i\
const __dirname = path.dirname(fileURLToPath(import.meta.url));\
const { registerDashboardRoutes } = await import(path.join(__dirname, "dashboard-routes.js"));\
registerDashboardRoutes(app);\
' "$INDEX_JS"

echo "[OK] Patched index.js. Backup: $BACKUP"
echo "Restart OpenClaw: sudo systemctl restart openclaw"
