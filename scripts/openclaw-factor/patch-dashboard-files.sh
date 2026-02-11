#!/usr/bin/env bash
# Patches dashboard.mjs: use GET /logs (unified), add Files tab and /api/pi-files, /api/pi-file.
# Run on Pi after dashboard-routes are installed in OpenClaw: sudo bash scripts/openclaw-factor/patch-dashboard-files.sh
set -euo pipefail

DASH="${DASH:-/opt/openclaw/src/dashboard.mjs}"
BACKUP="${DASH}.bak.files-$(date +%Y%m%d%H%M%S)"

if [ ! -f "$DASH" ]; then
  echo "Error: $DASH not found."
  exit 1
fi

cp -a "$DASH" "$BACKUP"
echo "[OK] Backup: $BACKUP"

# 1) Use GET /logs instead of shell tail (unified journal + agent.log)
sed -i 's|const data = await proxy("/tool/shell", "POST", { command: "tail -n 80 /data/agent-journal/\$(date +\\\\%Y-\\\\%m-\\\\%d).jsonl 2>/dev/null || echo '\''{}'\''" });|const data = await proxy("/logs?journal=80\&agentLog=200");|' "$DASH"
echo "[OK] /api/logs now uses GET /logs (unified)"

# 2) Add Files nav button after Logs button
sed -i 's|onclick="go('\''logs'\'')">📋 Logs</button>|onclick="go('\''logs'\'')">📋 Logs</button>\n  <button class="nav-btn" onclick="go('\''files'\'')">📁 Files</button>|' "$DASH"
echo "[OK] Added Files nav button"

# 3) Add Files panel after Logs panel (before </div> that closes .panels)
sed -i 's|  <!-- Logs Panel -->\n  <div class="panel" id="pLogs">\n    <div class="logs-scroll" id="logsScroll"></div>\n  </div>\n</div>|  <!-- Logs Panel -->\n  <div class="panel" id="pLogs">\n    <div class="logs-scroll" id="logsScroll"></div>\n  </div>\n  <!-- Files Panel -->\n  <div class="panel" id="pFiles">\n    <div class="files-toolbar"><input type="text" id="filesPath" placeholder="/opt/openclaw" style="width:60%;padding:6px;margin:4px;background:var(--surface2);border:1px solid var(--glass-border);border-radius:6px;color:var(--text)"/><button class="qbtn" onclick="loadFiles()">Go</button></div>\n    <div class="files-scroll" id="filesScroll"><div class="empty">Enter path and click Go (e.g. /opt/openclaw, /data)</div></div>\n    <pre id="fileContent" class="file-content" style="display:none;white-space:pre-wrap;padding:12px;font-size:12px;max-height:400px;overflow:auto"></pre>\n  </div>\n</div>|' "$DASH"
# If the above multiline sed fails on this system, we skip panel HTML and add via a second method
if ! grep -q "id=\"pFiles\"" "$DASH"; then
  # Fallback: insert before the closing </div> of .panels (before <div class="input-bar">)
  sed -i 's|  </div>\n</div>\n\n<div class="input-bar">|  </div>\n  <div class="panel" id="pFiles"><div class="files-toolbar"><input type="text" id="filesPath" placeholder="/opt/openclaw" style="width:60%;padding:6px;margin:4px;background:var(--surface2);border:1px solid var(--glass-border);border-radius:6px;color:var(--text)"/><button class="qbtn" onclick="loadFiles()">Go</button></div><div class="files-scroll" id="filesScroll"></div><pre id="fileContent" class="file-content" style="display:none;white-space:pre-wrap;padding:12px;font-size:12px;max-height:400px;overflow:auto"></pre></div>\n</div>\n\n<div class="input-bar">|' "$DASH"
fi
echo "[OK] Files panel added (or skipped if already present)"

# 4) Add go('files') in the nav button loop: change ['agents','chat','logs'] to ['agents','chat','logs','files']
sed -i "s/\['agents','chat','logs'\]\['agents','chat','logs'\]/['agents','chat','logs','files']/g" "$DASH"
sed -i "s/currentTab='agents',lastMsgId=0/currentTab='agents',lastMsgId=0,currentFilesPath='\/opt\/openclaw'/g" "$DASH"
# 5) Add pFiles to the panel toggle map
sed -i "s/pLogs'\[tab\]/pLogs','files':'pFiles'}[tab]/g" "$DASH"
sed -i "s/\('agents':'pAgents','chat':'pChat','logs':'pLogs'\)/\1,'files':'pFiles'/g" "$DASH"

# 6) Add /api/pi-files and /api/pi-file before "res.writeHead(404)"
sed -i 's|  if (url.pathname === "/api/proxy") {|  if (url.pathname === "/api/pi-files") {\n    try { const path = url.searchParams.get("path") || "/opt/openclaw"; const d = await proxy("/pi/files?path=" + encodeURIComponent(path)); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); }\n    catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }\n    return;\n  }\n  if (url.pathname === "/api/pi-file") {\n    try { const path = url.searchParams.get("path") || ""; const d = await proxy("/pi/file?path=" + encodeURIComponent(path)); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); }\n    catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }\n    return;\n  }\n  if (url.pathname === "/api/proxy") {|' "$DASH"
echo "[OK] Added /api/pi-files and /api/pi-file"

# 7) Add loadFiles and file viewer JS before pollStatus (or before setInterval)
# Simpler: add at end of script before </script>: async function loadFiles(){ const p=document.getElementById('filesPath').value||'/opt/openclaw'; const r=await fetch('/api/pi-files?path='+encodeURIComponent(p)); const d=await r.json(); const el=document.getElementById('filesScroll'); el.innerHTML=''; if(d.entries){ d.entries.forEach(e=>{ const div=document.createElement('div'); div.style.cssText='padding:4px 8px;cursor:pointer'; div.textContent=(e.type==='dir'?'📁 ':'📄 ')+e.name; div.onclick=()=>{ if(e.type==='dir'){ document.getElementById('filesPath').value=e.path; loadFiles(); } else { fetch('/api/pi-file?path='+encodeURIComponent(e.path)).then(r=>r.json()).then(d=>{ document.getElementById('fileContent').style.display='block'; document.getElementById('fileContent').textContent=d.content||d.error; }); } }; el.appendChild(div); }); } else if(d.error) el.textContent=d.error; } document.getElementById('fileContent').style.display='none'; }
# And call loadFiles when switching to files tab: in go(), if(tab==='files') loadFiles();
sed -i 's/if(tab==='\''chat'\'')'\''\$('\''input'\'').focus();/if(tab==='\''chat'\'') $('\''input'\'').focus(); if(tab==='\''files'\'') loadFiles();/' "$DASH"
# Add loadFiles function before pollStatus
sed -i 's/async function pollStatus(){/async function loadFiles(){ const p=document.getElementById("filesPath").value||"\/opt\/openclaw"; try{ const r=await fetch("\/api\/pi-files?path="+encodeURIComponent(p)); const d=await r.json(); const el=document.getElementById("filesScroll"); el.innerHTML=""; if(d.error){ el.textContent=d.error; return; } if(d.entries){ d.entries.forEach(e=>{ const div=document.createElement("div"); div.style.cssText="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--glass-border)"; div.textContent=(e.type==="dir"?"📁 ":"📄 ")+e.name; div.onclick=()=>{ if(e.type==="dir"){ document.getElementById("filesPath").value=e.path; loadFiles(); } else { fetch("\/api\/pi-file?path="+encodeURIComponent(e.path)).then(r=>r.json()).then(d=>{ document.getElementById("fileContent").style.display="block"; document.getElementById("fileContent").textContent=d.content||d.error||""; document.getElementById("filesScroll").style.display="none"; }); } }; el.appendChild(div); }); } document.getElementById("fileContent").style.display="none"; document.getElementById("filesScroll").style.display="block"; }catch(e){ document.getElementById("filesScroll").innerHTML="Error: "+e.message; } }\nasync function pollStatus(){/' "$DASH"
echo "[OK] Added loadFiles() and file viewer JS"

echo "Done. Restart dashboard: sudo systemctl restart piclaw-dashboard"
