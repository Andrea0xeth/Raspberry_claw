#!/usr/bin/env node
/**
 * Badge "online" based only on /api/health; agent-status optional (no more offline if agent-status fails).
 * Run on Pi: sudo node patch-status-health-only.mjs
 */
import fs from "fs/promises";

const DASH = process.env.DASHBOARD_PATH || "/opt/openclaw/src/dashboard.mjs";

let html = await fs.readFile(DASH, "utf8");

const old = `async function pollStatus(){ const sb=document.getElementById("statusBadge"); if(sb){ sb.textContent="checking..."; sb.className="badge info"; }
  try{
    const[h,s]=await Promise.all([fetch('/api/health?'+Date.now()).then(r=>r.json()),fetch('/api/agent-status?'+Date.now()).then(r=>r.json())]);
    $('statusBadge').className='badge '+(h.status==='ok'?'on':'off');
    $('statusBadge').textContent=h.status==='ok'?'online':'offline';
    $('mcpBadge').className='badge '+(h.factorMcp?'on':'off');
    $('mcpBadge').textContent='MCP '+(h.factorMcp?'✓':'✗');
    $('cycleBadge').textContent='C'+(s.cycles||0);
  }catch(e){$('statusBadge').className='badge off';$('statusBadge').textContent='offline';if(!window._statusRetried){window._statusRetried=true;setTimeout(pollStatus,2000);}}
}`;

// Same catch in new block (keep retry)
const neu = `async function pollStatus(){ const sb=document.getElementById("statusBadge"); if(sb){ sb.textContent="checking..."; sb.className="badge info"; }
  try{
    const h=await fetch('/api/health?'+Date.now()).then(r=>r.json());
    $('statusBadge').className='badge '+(h.status==='ok'?'on':'off');
    $('statusBadge').textContent=h.status==='ok'?'online':'offline';
    $('mcpBadge').className='badge '+(h.factorMcp?'on':'off');
    $('mcpBadge').textContent='MCP '+(h.factorMcp?'✓':'✗');
    fetch('/api/agent-status?'+Date.now()).then(r=>r.json()).then(s=>{$('cycleBadge').textContent='C'+(s.cycles||0);}).catch(()=>{});
  }catch(e){$('statusBadge').className='badge off';$('statusBadge').textContent='offline';if(!window._statusRetried){window._statusRetried=true;setTimeout(pollStatus,2000);}}
}`;

if (html.includes("const h=await fetch('/api/health?'")) {
  console.log("Already patched (health-only)");
  process.exit(0);
}
if (!html.includes("const[h,s]=await Promise.all([fetch('/api/health?'")) {
  console.error("Pattern not found");
  process.exit(1);
}
html = html.replace(old, neu);
await fs.writeFile(DASH, html);
console.log("Patched: badge from /api/health only, agent-status optional");
process.exit(0);
