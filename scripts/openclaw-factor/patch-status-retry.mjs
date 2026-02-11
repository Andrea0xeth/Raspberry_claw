#!/usr/bin/env node
/**
 * Add one-time retry in pollStatus() catch so dashboard recovers from transient failures.
 * Run on Pi: sudo node scripts/openclaw-factor/patch-status-retry.mjs
 */
import fs from "fs/promises";

const DASH = process.env.DASHBOARD_PATH || "/opt/openclaw/src/dashboard.mjs";

let html = await fs.readFile(DASH, "utf8");
const old = "}catch(e){$('statusBadge').className='badge off';$('statusBadge').textContent='offline'}";
const neu = "}catch(e){$('statusBadge').className='badge off';$('statusBadge').textContent='offline';if(!window._statusRetried){window._statusRetried=true;setTimeout(pollStatus,2000);}}";

if (html.includes("window._statusRetried")) {
  console.log("Already has retry");
  process.exit(0);
}
if (!html.includes(old)) {
  console.error("Pattern not found");
  process.exit(1);
}
html = html.replace(old, neu);
await fs.writeFile(DASH, html);
console.log("Patched: one-time retry on status failure");
process.exit(0);
