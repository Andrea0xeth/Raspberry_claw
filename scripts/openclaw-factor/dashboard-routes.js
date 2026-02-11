/**
 * Dashboard extension: /agent/messages, /logs (unified), /pi/files, /pi/file
 * ESM: use in index.js with:
 *   const { registerDashboardRoutes } = await import(path.join(__dirname, "dashboard-routes.js"));
 *   registerDashboardRoutes(app);
 */
import path from "path";
import fs from "fs/promises";

const JOURNAL_DIR = process.env.DATA_DIR || "/data";
const AGENT_JOURNAL = path.join(JOURNAL_DIR, "agent-journal");
const LOG_DIR = path.join(JOURNAL_DIR, "logs", "openclaw");
const ALLOWED_ROOTS = [
  path.resolve("/opt/openclaw"),
  path.resolve("/data"),
  path.resolve("/home/openclaw"),
  path.resolve("/home/pi"),
];

function resolveSafe(basePath, subPath) {
  const resolved = path.resolve(basePath, subPath || ".");
  for (const root of ALLOWED_ROOTS) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return resolved;
  }
  return null;
}

async function getRecentJournalEntries(limit = 100) {
  const entries = [];
  try {
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
  let content = entry.summary || JSON.stringify(entry);
  if (entry.type === "multi-agent" && Array.isArray(entry.delegations)) {
    to = entry.delegations.map((d) => d.worker).join(", ");
    type = "delegate";
    content = `Delegations: ${to}\n${content.substring(0, 800)}`;
  } else if (entry.type === "cycle") {
    type = "final";
    content = (entry.summary || "").substring(0, 1500);
  } else if (entry.type === "error") {
    type = "error";
    content = entry.message || entry.error || entry.summary || JSON.stringify(entry);
  } else if (entry.type === "tool") {
    from = entry.worker || "defi";
    type = "tool_call";
    content = `Tool: ${entry.name || ""} ${(entry.result && String(entry.result).substring(0, 200)) || ""}`;
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

async function getUnifiedLogs(maxJournal = 80, maxAgentLog = 200) {
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
  return out;
}

function registerDashboardRoutes(app) {
  /** Agent activity: messages from journal (supervisor, workers, cycles) */
  app.get("/agent/messages", async (req, res) => {
    try {
      const since = parseInt(req.query.since) || 0;
      const messages = await getAgentMessages(since);
      res.json({ messages });
    } catch (e) {
      res.status(500).json({ messages: [], error: e.message });
    }
  });

  /** Unified logs: today's journal jsonl + agent.log */
  app.get("/logs", async (req, res) => {
    try {
      const data = await getUnifiedLogs(
        parseInt(req.query.journal) || 80,
        parseInt(req.query.agentLog) || 200
      );
      res.json({ stdout: data.lines.join("\n"), result: data.lines.join("\n"), lines: data.lines, source: data.source });
    } catch (e) {
      res.status(500).json({ stdout: "", result: "", error: e.message });
    }
  });

  /** List directory (Pi files as repo). path= relative to allowed roots or absolute under allowed roots */
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

  /** Read file content (read-only). path= absolute or relative under allowed roots */
  app.get("/pi/file", async (req, res) => {
    try {
      const rawPath = req.query.path || "";
      if (!rawPath) return res.status(400).json({ error: "path required" });
      const resolved = resolveSafe("/", rawPath);
      if (!resolved) return res.status(403).json({ error: "Path not allowed" });
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat || !stat.isFile()) return res.status(404).json({ error: "Not found or not a file" });
      const maxSize = 1024 * 1024; // 1MB
      if (stat.size > maxSize) return res.status(413).json({ error: "File too large", maxSize });
      const content = await fs.readFile(resolved, "utf8");
      res.json({ path: rawPath, content, size: stat.size });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

export { registerDashboardRoutes };
