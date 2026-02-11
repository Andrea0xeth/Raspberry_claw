#!/usr/bin/env node
/**
 * Patches dashboard.mjs: unified /logs, Files tab, /api/pi-files, /api/pi-file.
 * Run on Pi: node scripts/openclaw-factor/patch-dashboard-apply.mjs
 * Reads from /opt/openclaw/src/dashboard.mjs, writes back (with backup).
 */
import fs from "fs/promises";
import path from "path";

const DASH = process.env.DASHBOARD_PATH || "/opt/openclaw/src/dashboard.mjs";

let html = await fs.readFile(DASH, "utf8");
const backup = DASH + ".bak.files-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
await fs.writeFile(backup, html);
console.log("Backup:", backup);

// 1) /api/logs: use GET /logs instead of shell
html = html.replace(
  /const data = await proxy\("\/tool\/shell", "POST", \{ command: "tail[^"]+" \}\);/,
  'const data = await proxy("/logs?journal=80&agentLog=200");'
);
console.log("1. /api/logs -> GET /logs");

// 2) Nav: add Files button after Logs
if (!html.includes('go(\'files\')')) {
  html = html.replace(
    /(<button class="nav-btn" onclick="go\('logs'\)">📋 Logs<\/button>)/,
    "$1\n  <button class=\"nav-btn\" onclick=\"go('files')\">📁 Files</button>"
  );
  console.log("2. Added Files nav button");
}

// 3) Panels: add Files panel (before </div> that closes .panels, i.e. before <div class="input-bar">)
const filesPanel = `  <!-- Files Panel -->
  <div class="panel" id="pFiles">
    <div class="files-toolbar"><input type="text" id="filesPath" placeholder="/opt/openclaw" style="width:60%;padding:6px;margin:4px;background:var(--surface2);border:1px solid var(--glass-border);border-radius:6px;color:var(--text)"/><button class="qbtn" onclick="goBack()" title="Parent folder">↑ Parent</button><button class="qbtn" onclick="setPathAndGo('/opt/openclaw')" title="Dashboard root">⌂ Home</button><button class="qbtn" onclick="loadFiles()">Go</button></div>
    <div class="files-scroll" id="filesScroll"><div class="empty">Enter path and click Go (e.g. /opt/openclaw, /data)</div></div>
    <pre id="fileContent" class="file-content" style="display:none;white-space:pre-wrap;padding:12px;font-size:12px;max-height:400px;overflow:auto"></pre>
  </div>
`;
if (!html.includes("id=\"pFiles\"")) {
  html = html.replace(
    /<div class="logs-scroll" id="logsScroll"><\/div>\s*<\/div>\s*<\/div>\s*<div class="input-bar">/,
    `<div class="logs-scroll" id="logsScroll"></div>\n  </div>\n${filesPanel}</div>\n\n<div class="input-bar">`
  );
  console.log("3. Added Files panel");
}

// 4) go() nav: add 'files' tab
html = html.replace(
  /\['agents','chat','logs'\]\[i\]===tab/,
  "['agents','chat','logs','files'][i]===tab"
);
html = html.replace(
  /'logs':'pLogs'\}\[tab\]\)\.classList\.add\('active'\)/,
  "'logs':'pLogs','files':'pFiles'}[tab]).classList.add('active')"
);
if (!html.includes("if(tab==='files')loadFiles()")) {
  html = html.replace(
    /if\(tab==='chat'\)\$\('input'\)\.focus\(\)/,
    "if(tab==='chat')$('input').focus(); if(tab==='files')loadFiles();"
  );
}
console.log("4. go() includes files tab and loadFiles() on switch");

// 5) API: add /api/pi-files and /api/pi-file
if (!html.includes("/api/pi-files")) {
  html = html.replace(
    /  if \(url\.pathname === "\/api\/proxy"\) \{/,
    `  if (url.pathname === "/api/pi-files") {
    try { const path = url.searchParams.get("path") || "/opt/openclaw"; const d = await proxy("/pi/files?path=" + encodeURIComponent(path)); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); }
    catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (url.pathname === "/api/pi-file") {
    try { const path = url.searchParams.get("path") || ""; const d = await proxy("/pi/file?path=" + encodeURIComponent(path)); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); }
    catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (url.pathname === "/api/proxy") {`
  );
  console.log("5. Added /api/pi-files and /api/pi-file");
}

// 6) setPathAndGo, goBack, loadFiles() and call on go('files')
const loadFilesFn = `function setPathAndGo(path){ const inp=document.getElementById("filesPath"); if(inp){ inp.value=path; loadFiles(); } }
function goBack(){ const inp=document.getElementById("filesPath"); if(!inp)return; let p=inp.value.trim()||"/opt/openclaw"; if(p==="/"||!p)return; const parts=p.replace(/\\/+/g,"/").split("/").filter(Boolean); if(parts.length===0)return; parts.pop(); inp.value=parts.length?"/"+parts.join("/"):"/"; loadFiles(); }
async function loadFiles(){
  const p=(document.getElementById("filesPath")&&document.getElementById("filesPath").value)||"/opt/openclaw";
  try{
    const r=await fetch("/api/pi-files?path="+encodeURIComponent(p));
    const d=await r.json();
    const el=document.getElementById("filesScroll");
    const fc=document.getElementById("fileContent");
    if(!el)return;
    el.innerHTML="";
    if(d.error){ el.textContent=d.error; if(fc)fc.style.display="none"; return; }
    if(d.entries){
      d.entries.forEach(e=>{
        const div=document.createElement("div");
        div.style.cssText="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--glass-border)";
        div.textContent=(e.type==="dir"?"📁 ":"📄 ")+e.name;
        div.onclick=()=>{
          if(e.type==="dir"){ (document.getElementById("filesPath")||{}).value=e.path; loadFiles(); }
          else {
            fetch("/api/pi-file?path="+encodeURIComponent(e.path)).then(r=>r.json()).then(d=>{ if(fc){ fc.style.display="block"; fc.textContent=d.content||d.error||""; } if(el)el.style.display="none"; });
          }
        };
        el.appendChild(div);
      });
    }
    if(fc)fc.style.display="none";
    if(el)el.style.display="block";
  }catch(e){ const el=document.getElementById("filesScroll"); if(el)el.innerHTML="Error: "+e.message; }
}
`;
if (!html.includes("async function loadFiles()")) {
  html = html.replace(
    /async function pollStatus\(\)/,
    loadFilesFn + "async function pollStatus()"
  );
  html = html.replace(
    /if\(tab==='chat'\)\$('input')\.focus\(\)/,
    "if(tab==='chat')$('input').focus(); if(tab==='files')loadFiles();"
  );
  console.log("6. Added loadFiles() and go('files') call");
}

await fs.writeFile(DASH, html);
console.log("Written:", DASH);
console.log("Restart: sudo systemctl restart piclaw-dashboard");
