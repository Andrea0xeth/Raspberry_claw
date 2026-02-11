#!/usr/bin/env node
/**
 * Add 15s timeout to health fetch so tunnel latency doesn't cause "offline".
 * Run on Pi: sudo node patch-health-timeout.mjs
 */
import fs from "fs/promises";

const DASH = process.env.DASHBOARD_PATH || "/opt/openclaw/src/dashboard.mjs";

let html = await fs.readFile(DASH, "utf8");

const old = "const h=await fetch('/api/health?'+Date.now()).then(r=>r.json());";
const neu = "const ac=new AbortController();const t=setTimeout(()=>ac.abort(),15000);const h=await fetch('/api/health?'+Date.now(),{signal:ac.signal}).then(r=>r.json());clearTimeout(t);";

if (html.includes("AbortController();const t=setTimeout")) {
  console.log("Already has health timeout");
  process.exit(0);
}
if (!html.includes(old)) {
  console.error("Pattern not found:", old.slice(0, 50));
  process.exit(1);
}
html = html.replace(old, neu);
await fs.writeFile(DASH, html);
console.log("Patched: 15s timeout for health fetch");
process.exit(0);
