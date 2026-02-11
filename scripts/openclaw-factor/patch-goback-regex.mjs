#!/usr/bin/env node
/**
 * Fix goBack() regex that breaks inside template literal.
 * /\/+/g in a backtick template becomes //+/g (comment!) 
 * Fix: use /[/]+/g instead.
 * Run on Pi: sudo node patch-goback-regex.mjs
 */
import fs from "fs/promises";

const DASH = process.env.DASHBOARD_PATH || "/opt/openclaw/src/dashboard.mjs";

let html = await fs.readFile(DASH, "utf8");

// The source has /\/+/g which inside template literal `` becomes //+/g (JS comment!)
const old = 'p.replace(/\\/+/g,"/")';
const neu = 'p.replace(/[/]+/g,"/")';

if (html.includes(neu)) {
  console.log("Already fixed");
  process.exit(0);
}
if (!html.includes(old)) {
  console.error("Pattern not found - checking raw...");
  // Try to find it differently
  const idx = html.indexOf("goBack");
  if (idx >= 0) {
    console.error("goBack found at char", idx);
    console.error("Context:", html.substring(idx, idx + 300));
  }
  process.exit(1);
}
html = html.replace(old, neu);
await fs.writeFile(DASH, html);
console.log("Fixed: /\\/+/g -> /[/]+/g in goBack()");
process.exit(0);
