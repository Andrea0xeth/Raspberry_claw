/**
 * Dashboard API: /agent/messages, /logs (unified), /pi/files, /pi/file, /pi/system
 * ESM: registerDashboardRoutes(app) from index.js
 */
import path from "path";
import fs from "fs/promises";
import { readFileSync } from "fs";
import { execSync } from "child_process";

const JOURNAL_DIR = process.env.DATA_DIR || "/data";
const AGENT_JOURNAL = path.join(JOURNAL_DIR, "agent-journal");
const LOG_DIR = process.env.LOG_DIR || path.join(JOURNAL_DIR, "logs", "openclaw");
const ALLOWED_ROOTS = [
  path.resolve("/opt/openclaw"),
  path.resolve("/data"),
  path.resolve("/home/openclaw"),
  path.resolve("/home/pi"),
  path.resolve("/var/log"),
  path.resolve("/"),
];

function run(cmd, encoding = "utf8") {
  try {
    return execSync(cmd, { encoding, timeout: 5000, maxBuffer: 64 * 1024 }).trim();
  } catch (_) {
    return null;
  }
}

function parseMeminfo() {
  try {
    const raw = readFileSync("/proc/meminfo", "utf8");
    const out = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^(\w+):\s+(\d+)/);
      if (m) out[m[1]] = parseInt(m[2], 10);
    }
    return out;
  } catch (_) {
    return {};
  }
}

async function getPiSystemInfo() {
  const tempRaw = run("vcgencmd measure_temp 2>/dev/null");
  const throttledRaw = run("vcgencmd get_throttled 2>/dev/null");
  const loadRaw = run("cat /proc/loadavg 2>/dev/null");
  const uptimeRaw = run("cat /proc/uptime 2>/dev/null");
  const meminfo = parseMeminfo();
  const dfRaw = run("df -h / /boot 2>/dev/null | tail -n +2");
  const cpuModel = run("grep -m1 'Model name\\|Hardware' /proc/cpuinfo 2>/dev/null");
  const cpuCount = run("grep -c ^processor /proc/cpuinfo 2>/dev/null");
  const hostname = run("hostname 2>/dev/null");
  const uname = run("uname -a 2>/dev/null");
  const gpuMem = run("vcgencmd get_mem gpu 2>/dev/null");
  const armMem = run("vcgencmd get_mem arm 2>/dev/null");
  const volt = run("vcgencmd measure_volts core 2>/dev/null");
  const clockArm = run("vcgencmd measure_clock arm 2>/dev/null");

  let temperature = null;
  if (tempRaw && tempRaw.startsWith("temp=")) {
    const match = tempRaw.match(/temp=([\d.]+)'?C?/);
    if (match) temperature = { value: parseFloat(match[1]), unit: "°C", raw: tempRaw };
  }

  let throttled = null;
  if (throttledRaw && throttledRaw.startsWith("throttled=")) {
    const hex = throttledRaw.replace("throttled=", "").trim();
    throttled = { raw: hex, decoded: null };
    if (hex !== "0x0") {
      const v = parseInt(hex, 16);
      const flags = [];
      if (v & (1 << 0)) flags.push("Under-voltage");
      if (v & (1 << 1)) flags.push("Arm freq capped");
      if (v & (1 << 2)) flags.push("Throttled");
      if (v & (1 << 16)) flags.push("Under-voltage occurred");
      if (v & (1 << 17)) flags.push("Arm freq capped occurred");
      if (v & (1 << 18)) flags.push("Throttling occurred");
      throttled.decoded = flags.length ? flags : ["OK"];
    } else throttled.decoded = ["OK"];
  }

  let load = null;
  if (loadRaw) {
    const parts = loadRaw.split(/\s+/);
    load = { load1: parseFloat(parts[0]) || 0, load5: parseFloat(parts[1]) || 0, load15: parseFloat(parts[2]) || 0, raw: loadRaw };
  }

  let uptimeSeconds = null;
  if (uptimeRaw) {
    const sec = parseFloat(uptimeRaw.split(/\s+/)[0]);
    if (!isNaN(sec)) uptimeSeconds = sec;
  }
  const uptimeFormatted = uptimeSeconds != null ? formatUptime(uptimeSeconds) : null;

  const memTotal = meminfo.MemTotal;
  const memAvailable = meminfo.MemAvailable != null ? meminfo.MemAvailable : (meminfo.MemFree || 0) + (meminfo.Buffers || 0) + (meminfo.Cached || 0);
  const memUsed = memTotal != null && memAvailable != null ? memTotal - memAvailable : null;
  const memory = (memTotal != null && memUsed != null)
    ? {
        totalKb: memTotal,
        availableKb: memAvailable,
        usedKb: memUsed,
        totalMb: (memTotal / 1024).toFixed(1),
        usedMb: (memUsed / 1024).toFixed(1),
        availableMb: (memAvailable / 1024).toFixed(1),
        percentUsed: ((memUsed / memTotal) * 100).toFixed(1),
      }
    : null;

  let disks = [];
  if (dfRaw) {
    for (const line of dfRaw.split("\n").filter(Boolean)) {
      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        disks.push({
          mount: parts[5],
          size: parts[1],
          used: parts[2],
          avail: parts[3],
          usePct: parts[4],
        });
      }
    }
  }

  return {
    temperature,
    throttled,
    load,
    uptimeSeconds,
    uptimeFormatted,
    memory,
    disks,
    cpu: { model: cpuModel || null, cores: cpuCount ? parseInt(cpuCount, 10) : null },
    hostname: hostname || null,
    uname: uname || null,
    gpuMem: gpuMem || null,
    armMem: armMem || null,
    volt: volt || null,
    clockArm: clockArm ? clockArm.replace("frequency(45)=", "").trim() : null,
    at: new Date().toISOString(),
  };
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(d + "d");
  parts.push(h + "h");
  parts.push(m + "m");
  return parts.join(" ");
}

function resolveSafe(basePath, subPath) {
  const resolved = path.resolve(basePath, subPath || ".");
  for (const root of ALLOWED_ROOTS) {
    if (resolved === root) return resolved;
    if (root === path.resolve("/") && resolved.startsWith("/")) return resolved;
    if (resolved.startsWith(root + path.sep)) return resolved;
  }
  return null;
}

async function getRecentJournalEntries(limit = 100) {
  const entries = [];
  try {
    await fs.mkdir(AGENT_JOURNAL, { recursive: true });
    const files = await fs.readdir(AGENT_JOURNAL).catch(() => []);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl") && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().reverse();
    let count = 0;
    for (const f of jsonlFiles) {
      if (count >= limit) break;
      const lines = (await fs.readFile(path.join(AGENT_JOURNAL, f), "utf8").catch(() => "")).split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0 && count < limit; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          entry._file = f;
          entry._line = i;
          entries.push(entry);
          count++;
        } catch (_) {}
      }
    }
  } catch (_) {}
  return entries.reverse();
}

function journalToMessage(entry, id) {
  const ts = entry.timestamp || entry.ts || new Date().toISOString();
  let from = "supervisor";
  let to = "";
  let type = "msg";
  let content = entry.summary || entry.content || JSON.stringify(entry);
  if (entry.type === "chat") {
    from = entry.role === "user" ? "user" : "0xpiclaw.eth";
    type = "msg";
    content = entry.content || entry.summary || "";
    if (entry.reasoning) content = `[Reasoning] ${entry.reasoning}\n\n${content}`;
  } else if (entry.type === "multi-agent" && Array.isArray(entry.delegations)) {
    to = entry.delegations.map((d) => d.worker).join(", ");
    type = "delegate";
    content = `Delegations: ${to}\n${content}`;
  } else if (entry.type === "cycle") {
    type = "final";
    content = entry.summary || "";
  } else if (entry.type === "error") {
    type = "error";
    content = entry.message || entry.error || entry.summary || JSON.stringify(entry);
  } else if (entry.type === "tool" || entry.type === "tool_call") {
    from = "0xpiclaw.eth";
    type = "tool_call";
    content = `Tool: ${entry.name || ""} ${(entry.result && String(entry.result)) || ""}`;
  }
  return { id, from, to, type, content, ts, tokens: entry.tokens?.total_tokens };
}

async function getAgentMessages(sinceId = 0) {
  const entries = await getRecentJournalEntries(150);
  const messages = [];
  let id = 1;
  for (const e of entries) {
    const msg = journalToMessage(e, id);
    msg.id = id;
    if (id > sinceId) messages.push(msg);
    id++;
  }
  return messages.filter((m) => m.id > sinceId);
}

async function getUnifiedLogs(maxJournal = 80, maxAgentLog = 200, maxSyslog = 100) {
  const out = { lines: [], source: [] };
  const today = new Date().toISOString().split("T")[0];
  const jsonlPath = path.join(AGENT_JOURNAL, `${today}.jsonl`);
  try {
    const text = await fs.readFile(jsonlPath, "utf8");
    const lines = text.split("\n").filter(Boolean).slice(-maxJournal);
    for (const line of lines) {
      out.lines.push(line);
      out.source.push("journal");
    }
  } catch (_) {}
  try {
    const logPath = path.join(LOG_DIR, "agent.log");
    const text = await fs.readFile(logPath, "utf8");
    const lines = text.split("\n").filter(Boolean).slice(-maxAgentLog);
    for (const line of lines) {
      out.lines.push(line);
      out.source.push("agent.log");
    }
  } catch (_) {}
  try {
    const syslogPath = "/var/log/syslog";
    const text = await fs.readFile(syslogPath, "utf8");
    const lines = text.split("\n").filter(Boolean).slice(-maxSyslog);
    for (const line of lines) {
      out.lines.push(line);
      out.source.push("syslog");
    }
  } catch (_) {}
  return out;
}

export function registerDashboardRoutes(app) {
  app.get("/agent/messages", async (req, res) => {
    try {
      const since = parseInt(req.query.since) || 0;
      const messages = await getAgentMessages(since);
      res.json({ messages });
    } catch (e) {
      res.status(500).json({ messages: [], error: e.message });
    }
  });

  app.get("/logs", async (req, res) => {
    try {
      const data = await getUnifiedLogs(
        parseInt(req.query.journal) || 80,
        parseInt(req.query.agentLog) || 200,
        parseInt(req.query.syslog) || 100
      );
      const sections = [];
      let current = { source: null, lines: [] };
      for (let i = 0; i < data.lines.length; i++) {
        const src = data.source[i] || "log";
        const line = data.lines[i];
        if (src !== current.source) {
          if (current.lines.length) sections.push({ source: current.source, lines: current.lines });
          current = { source: src, lines: [line] };
        } else {
          current.lines.push(line);
        }
      }
      if (current.lines.length) sections.push({ source: current.source, lines: current.lines });
      res.json({
        stdout: data.lines.join("\n"),
        result: data.lines.join("\n"),
        lines: data.lines,
        source: data.source,
        sections,
      });
    } catch (e) {
      res.status(500).json({ stdout: "", result: "", error: e.message });
    }
  });

  app.get("/pi/system", async (req, res) => {
    try {
      const info = await getPiSystemInfo();
      res.json(info);
    } catch (e) {
      res.status(500).json({ error: e.message, at: new Date().toISOString() });
    }
  });

  app.get("/pi/files", async (req, res) => {
    try {
      const rawPath = req.query.path || "/opt/openclaw";
      const resolved = resolveSafe("/", rawPath);
      if (!resolved) {
        return res.status(403).json({ error: "Path not allowed" });
      }
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat) return res.status(404).json({ error: "Not found" });
      if (!stat.isDirectory()) {
        return res.json({ path: rawPath, type: "file", name: path.basename(resolved), size: stat.size });
      }
      const names = await fs.readdir(resolved);
      const entries = [];
      for (const name of names.sort()) {
        const full = path.join(resolved, name);
        const st = await fs.stat(full).catch(() => null);
        if (!st) continue;
        entries.push({
          name,
          type: st.isDirectory() ? "dir" : "file",
          size: st.isFile() ? st.size : undefined,
          path: path.join(rawPath, name).replace(/\/+/g, "/"),
        });
      }
      res.json({ path: rawPath, type: "dir", entries });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/pi/file", async (req, res) => {
    try {
      const rawPath = req.query.path || "";
      if (!rawPath) return res.status(400).json({ error: "path required" });
      const resolved = resolveSafe("/", rawPath);
      if (!resolved) return res.status(403).json({ error: "Path not allowed" });
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat || !stat.isFile()) return res.status(404).json({ error: "Not found or not a file" });
      const maxSize = 1024 * 1024;
      if (stat.size > maxSize) return res.status(413).json({ error: "File too large", maxSize });
      const content = await fs.readFile(resolved, "utf8");
      res.json({ path: rawPath, content, size: stat.size });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

/** Append one line to today's agent journal (call from index.js chat/tool handlers). */
export async function appendAgentJournal(entry) {
  const today = new Date().toISOString().split("T")[0];
  const file = path.join(AGENT_JOURNAL, `${today}.jsonl`);
  await fs.mkdir(AGENT_JOURNAL, { recursive: true });
  const line = JSON.stringify({ ...entry, timestamp: entry.timestamp || new Date().toISOString() }) + "\n";
  await fs.appendFile(file, line);
}
