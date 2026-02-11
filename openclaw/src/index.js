/**
 * 0xpiclaw.eth — DeFi agent on Raspberry Pi
 * Bare-bones: Express + MiniMax OAuth + Factor MCP Bridge
 * Tools and prompts will be added as skills.
 */

import express from "express";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { createLogger, format, transports } from "winston";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, "..", "skills");

// ─── Config ─────────────────────────────────────────────────────────────────
const OAUTH_TOKEN_FILE = "/opt/openclaw/.minimax_oauth.json";
const MINIMAX_CLIENT_ID = "78257093-7e40-4613-99e0-527b14b39113";
const MINIMAX_OAUTH_SCOPE = "group_id profile model.completion";
const MINIMAX_BASE_URL = "https://api.minimax.io";

let _oauthTokens = null;
try { _oauthTokens = JSON.parse(await fs.readFile(OAUTH_TOKEN_FILE, "utf8")); } catch {}

let _minimaxKey = process.env.MINIMAX_API_KEY || "";
try { const k = (await fs.readFile("/opt/openclaw/.minimax_key", "utf8")).trim(); if (k) _minimaxKey = k; } catch {}

const CONFIG = {
    port: parseInt(process.env.OPENCLAW_PORT || "3100"),
    minimaxModel: process.env.MINIMAX_MODEL || "MiniMax-M2.1",
    minimaxUrl: `${MINIMAX_BASE_URL}/anthropic/v1/messages`,
    factorMcpPath: process.env.FACTOR_MCP_PATH || "/opt/openclaw/factor-mcp/dist/index.js",
    logDir: process.env.LOG_DIR || "/data/logs/openclaw",
};

// ─── Logger ─────────────────────────────────────────────────────────────────
await fs.mkdir(CONFIG.logDir, { recursive: true });

const logger = createLogger({
    level: "info",
    format: format.combine(format.timestamp(), format.json()),
    transports: [
        new transports.File({ filename: path.join(CONFIG.logDir, "error.log"), level: "error" }),
        new transports.File({ filename: path.join(CONFIG.logDir, "agent.log") }),
        new transports.Console({ format: format.combine(format.colorize(), format.simple()) }),
    ],
});

// ─── MiniMax OAuth ──────────────────────────────────────────────────────────
const MiniMaxOAuth = {
    tokens: _oauthTokens,
    pendingAuth: null,

    getBearer() {
        if (this.tokens?.access) return this.tokens.access;
        return _minimaxKey || null;
    },
    hasOAuth() { return !!(this.tokens?.access && this.tokens?.refresh); },
    isExpired() {
        if (!this.tokens?.expires) return true;
        return Date.now() > (this.tokens.expires * 1000) - 300000;
    },

    async saveTokens(tokens) {
        this.tokens = tokens;
        await fs.writeFile(OAUTH_TOKEN_FILE, JSON.stringify(tokens, null, 2), "utf8");
        await fs.chmod(OAUTH_TOKEN_FILE, 0o600);
    },

    async refreshToken() {
        if (!this.tokens?.refresh) throw new Error("No refresh token");
        const body = new URLSearchParams({
            grant_type: "refresh_token", client_id: MINIMAX_CLIENT_ID, refresh_token: this.tokens.refresh,
        });
        const resp = await fetch(`${MINIMAX_BASE_URL}/oauth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body,
        });
        const data = await resp.json();
        if (data.access_token && data.refresh_token) {
            const t = {
                access: data.access_token, refresh: data.refresh_token,
                expires: data.expired_in || (Math.floor(Date.now() / 1000) + 3600),
                resourceUrl: data.resource_url || this.tokens.resourceUrl,
            };
            await this.saveTokens(t);
            return t;
        }
        throw new Error(`Refresh failed: ${data.base_resp?.status_msg || JSON.stringify(data)}`);
    },

    async ensureValidToken() {
        if (this.hasOAuth() && this.isExpired()) {
            try { await this.refreshToken(); } catch (e) {
                this.tokens = null;
                throw new Error(`Token refresh failed: ${e.message}. Re-authenticate with /auth/minimax`);
            }
        }
        const bearer = this.getBearer();
        if (!bearer) throw new Error("Not authenticated. Use /auth/minimax to login via OAuth.");
        return bearer;
    },

    async startAuth() {
        const verifier = crypto.randomBytes(32).toString("base64url");
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
        const state = crypto.randomBytes(16).toString("base64url");
        const body = new URLSearchParams({
            response_type: "code", client_id: MINIMAX_CLIENT_ID, scope: MINIMAX_OAUTH_SCOPE,
            code_challenge: challenge, code_challenge_method: "S256", state,
        });
        const resp = await fetch(`${MINIMAX_BASE_URL}/oauth/code`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "x-request-id": crypto.randomUUID() },
            body,
        });
        if (!resp.ok) throw new Error(`OAuth code request failed: ${await resp.text()}`);
        const data = await resp.json();
        if (!data.user_code || !data.verification_uri) throw new Error(data.error || "OAuth incomplete");
        if (data.state !== state) throw new Error("OAuth state mismatch");
        this.pendingAuth = { verifier, userCode: data.user_code, verificationUri: data.verification_uri, expiresAt: data.expired_in, polling: true };
        this._pollForToken();
        return { user_code: data.user_code, verification_uri: data.verification_uri };
    },

    async _pollForToken() {
        if (!this.pendingAuth) return;
        const { verifier, userCode, expiresAt } = this.pendingAuth;
        let interval = 2000;
        while (this.pendingAuth?.polling && Date.now() < expiresAt * 1000) {
            await new Promise(r => setTimeout(r, interval));
            if (!this.pendingAuth?.polling) break;
            try {
                const body = new URLSearchParams({
                    grant_type: "urn:ietf:params:oauth:grant-type:user_code",
                    client_id: MINIMAX_CLIENT_ID, user_code: userCode, code_verifier: verifier,
                });
                const resp = await fetch(`${MINIMAX_BASE_URL}/oauth/token`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                    body,
                });
                const data = await resp.json();
                if (data.status === "success" && data.access_token) {
                    await this.saveTokens({
                        access: data.access_token, refresh: data.refresh_token,
                        expires: data.expired_in || (Math.floor(Date.now() / 1000) + 3600),
                        resourceUrl: data.resource_url,
                    });
                    this.pendingAuth = { ...this.pendingAuth, polling: false, completed: true };
                    return;
                }
                if (data.status === "error") { this.pendingAuth = { ...this.pendingAuth, polling: false, error: data.base_resp?.status_msg || "Auth failed" }; return; }
                interval = Math.min(interval * 1.5, 10000);
            } catch { interval = Math.min(interval * 2, 15000); }
        }
        if (this.pendingAuth?.polling) this.pendingAuth = { ...this.pendingAuth, polling: false, error: "Timed out" };
    },
};

// ─── Tool Call Parser ────────────────────────────────────────────────────────
function extractToolCall(text) {
    const marker = "[TOOL_CALL:";
    const idx = text.indexOf(marker);
    if (idx === -1) return null;
    const afterMarker = idx + marker.length;
    const colonIdx = text.indexOf(":", afterMarker);
    if (colonIdx === -1) return null;
    const toolName = text.substring(afterMarker, colonIdx);
    const jsonStart = colonIdx + 1;
    let depth = 0, inString = false, escaped = false;
    for (let i = jsonStart; i < text.length; i++) {
        const c = text[i];
        if (escaped) { escaped = false; continue; }
        if (c === "\\" && inString) { escaped = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === "{") depth++;
        else if (c === "}") {
            depth--;
            if (depth === 0) {
                const params = text.substring(jsonStart, i + 1);
                const endIdx = (text[i + 1] === "]") ? i + 2 : i + 1;
                return { toolName, params, fullMatch: text.substring(idx, endIdx) };
            }
        }
    }
    return null;
}

// ─── Skills (external prompt modules) ────────────────────────────────────────
async function loadSkills() {
    try {
        const files = await fs.readdir(SKILLS_DIR);
        const md = files.filter(f => f.endsWith(".md")).sort();
        const parts = [];
        for (const f of md) {
            const content = await fs.readFile(path.join(SKILLS_DIR, f), "utf8");
            parts.push(content);
        }
        return parts.join("\n\n---\n\n");
    } catch (e) {
        return "";
    }
}

const BASE_PROMPT = `You are 0xpiclaw.eth, a DeFi agent on a Raspberry Pi 4. You speak English.
Your wallet: 0x8Ac130E606545aD94E26fCF09CcDd950A981A704. Chains: ARBITRUM_ONE, BASE, MAINNET.

To call a tool use exactly: [TOOL_CALL:toolName:jsonObject]
- toolName = the actual tool (e.g. factor_get_config, factor_get_owned_vaults). NOT the word "name".
- jsonObject = a JSON object, use {} for no params. Examples: [TOOL_CALL:factor_get_config:{}] or [TOOL_CALL:factor_set_chain:{"chain":"ARBITRUM_ONE"}]
`;

let SYSTEM_PROMPT = BASE_PROMPT;
try {
    const skillText = await loadSkills();
    if (skillText) {
        SYSTEM_PROMPT = BASE_PROMPT + "\n\n" + skillText;
        logger.info("[SKILLS] Loaded skills from " + SKILLS_DIR);
    }
} catch (e) {
    logger.warn("[SKILLS] Load failed: " + e.message);
}

// ─── AI Engine (MiniMax) ────────────────────────────────────────────────────
class AIEngine {
    constructor() { this.conversations = new Map(); }

    getHistory(chatId) {
        if (!this.conversations.has(chatId)) this.conversations.set(chatId, []);
        const msgs = this.conversations.get(chatId);
        if (msgs.length > 20) this.conversations.set(chatId, msgs.slice(-20));
        return this.conversations.get(chatId);
    }
    addMessage(chatId, role, content) { this.getHistory(chatId).push({ role, content }); }
    clearHistory(chatId) { this.conversations.delete(chatId); }

    async callMiniMax(systemPrompt, messages, retries = 1) {
        const bearer = await MiniMaxOAuth.ensureValidToken();
        const body = {
            model: CONFIG.minimaxModel, max_tokens: 8192,
            system: systemPrompt, messages, temperature: 0.7,
        };
        const doCall = async () => {
            if (AIEngine._apiLock) await AIEngine._apiLock;
            let _resolve;
            AIEngine._apiLock = new Promise(r => { _resolve = r; });
            try {
                const response = await axios.post(CONFIG.minimaxUrl, body, {
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}`, "anthropic-version": "2023-06-01" },
                });
                return response.data;
            } finally { _resolve(); AIEngine._apiLock = null; }
        };
        let data = await doCall();
        let text = data.content?.map(c => c.text || "").join("") || "";
        if (!text && retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            data = await doCall();
            text = data.content?.map(c => c.text || "").join("") || "";
        }
        const usage = data.usage || {};
        if (!text) usage._error = data.error?.message || "empty response";
        return { text, usage };
    }

    async chat(message, chatId = "default", systemPrompt = SYSTEM_PROMPT, { maxRounds = 10 } = {}) {
        if (!MiniMaxOAuth.getBearer()) throw new Error("Not authenticated. Use /auth/minimax");
        this.addMessage(chatId, "user", message);
        const history = this.getHistory(chatId);
        logger.info(`[AI] Chat [${chatId}]: "${message.substring(0, 80)}..." (${history.length} msgs)`);

        try {
            let result = await this.callMiniMax(systemPrompt, history.map(m => ({ role: m.role, content: m.content })));
            let totalTokens = (result.usage.input_tokens || 0) + (result.usage.output_tokens || 0);

            // Tool call loop
            for (let round = 0; round < maxRounds; round++) {
                const tc = extractToolCall(result.text);
                if (!tc) break;
                logger.info(`[AI] Tool: ${tc.toolName}(${tc.params.substring(0, 100)})`);

                let toolResult;
                try {
                    const params = JSON.parse(tc.params);
                    if (tools[tc.toolName]) {
                        toolResult = await tools[tc.toolName](params);
                    } else if (tc.toolName.startsWith("factor_") && tools.factor) {
                        toolResult = await tools.factor({ tool: tc.toolName, params });
                    } else {
                        toolResult = { error: `Unknown tool: ${tc.toolName}` };
                    }
                } catch (e) { toolResult = { error: e.message }; }

                this.addMessage(chatId, "assistant", result.text);
                const resultStr = JSON.stringify(toolResult, null, 2);
                const truncated = resultStr.length > 2000 ? resultStr.substring(0, 2000) + "\n...(truncated)" : resultStr;
                this.addMessage(chatId, "user", `[TOOL_RESULT:${tc.toolName}]\n${truncated}`);

                try {
                    result = await this.callMiniMax(systemPrompt, this.getHistory(chatId).map(m => ({ role: m.role, content: m.content })));
                    totalTokens += (result.usage.input_tokens || 0) + (result.usage.output_tokens || 0);
                } catch (e) {
                    result = { text: `Tool ${tc.toolName} result: ${truncated.substring(0, 300)}`, usage: {} };
                    break;
                }
            }

            // Clean leftover tool calls
            let clean = result.text || "";
            while (true) { const l = extractToolCall(clean); if (!l) break; clean = clean.replace(l.fullMatch, ""); }
            clean = clean.trim() || "Empty response from AI.";

            this.addMessage(chatId, "assistant", clean);
            logger.info(`[AI] Response: ${clean.substring(0, 80)}... (${totalTokens} tokens)`);
            return { success: true, response: clean, engine: "minimax", model: CONFIG.minimaxModel, tokens: { total: totalTokens } };
        } catch (error) {
            history.pop();
            logger.error(`[AI] Error: ${error.message}`);
            throw error;
        }
    }
}
AIEngine._apiLock = null;

const ai = new AIEngine();
const tools = {}; // Empty — will be populated as skills are added

// ─── Factor MCP Bridge ──────────────────────────────────────────────────────
class FactorMCPBridge {
    constructor(mcpPath) {
        this.mcpPath = mcpPath;
        this.requestId = 0;
        this.process = null;
        this.pending = new Map();
        this.buffer = "";
        this.ready = false;
    }

    async start() {
        try { await fs.access(this.mcpPath); } catch {
            logger.warn("[FACTOR] MCP not found at " + this.mcpPath);
            return false;
        }
        this.process = spawn("node", [this.mcpPath], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });

        this.process.stdout.on("data", (data) => {
            this.buffer += data.toString();
            const lines = this.buffer.split("\n");
            this.buffer = lines.pop() || "";
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.id !== undefined && this.pending.has(msg.id)) {
                        this.pending.get(msg.id)(msg);
                        this.pending.delete(msg.id);
                    }
                } catch {}
            }
        });
        this.process.stderr.on("data", (d) => { const m = d.toString().trim(); if (m) logger.info(`[FACTOR:stderr] ${m.substring(0, 200)}`); });
        this.process.on("exit", (code) => { logger.warn(`[FACTOR] exited ${code}`); this.ready = false; setTimeout(() => this.start(), 5000); });

        try {
            const init = await this.send("initialize", {
                protocolVersion: "2024-11-05", capabilities: {},
                clientInfo: { name: "0xpiclaw.eth", version: "2.0.0" },
            });
            logger.info(`[FACTOR] init OK: ${JSON.stringify(init).substring(0, 200)}`);
            this.notify("notifications/initialized");
            this.ready = true;
            return true;
        } catch (e) { logger.error(`[FACTOR] init failed: ${e.message}`); return false; }
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.process) return reject(new Error("MCP not running"));
            const id = ++this.requestId;
            this.pending.set(id, (r) => { if (r.error) reject(new Error(r.error.message || JSON.stringify(r.error))); else resolve(r.result); });
            this.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        });
    }

    notify(method, params = {}) {
        if (!this.process) return;
        this.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    }

    async callTool(name, args = {}) {
        if (!this.ready) throw new Error("Factor MCP not connected");
        logger.info(`[FACTOR] ${name}(${JSON.stringify(args).substring(0, 100)})`);
        const result = await this.send("tools/call", { name, arguments: args });
        const text = result?.content?.map(c => c.text || "").join("") || JSON.stringify(result);
        try { return JSON.parse(text); } catch { return { result: text }; }
    }

    async listTools() {
        if (!this.ready) return [];
        const result = await this.send("tools/list", {});
        return result?.tools || [];
    }
}

const factorBridge = new FactorMCPBridge(CONFIG.factorMcpPath);

// ─── Discord Webhook ────────────────────────────────────────────────────────
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1470438238039703667/RjSMg_d7hrsoN_Noe8SybysQkEG6CKocm6ZvBXVgRqTbiKK2jO2pSPWDiotFoalpDgck";
const DISCORD_THREAD_ID = "1470412059429699738";

async function sendDiscordMessage(content) {
    if (!DISCORD_WEBHOOK_URL) return false;
    try {
        const resp = await fetch(`${DISCORD_WEBHOOK_URL}?thread_id=${DISCORD_THREAD_ID}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: content.substring(0, 2000), username: "0xpiclaw.eth" }),
        });
        if (!resp.ok) { logger.warn(`[DISCORD] ${resp.status}`); return false; }
        logger.info("[DISCORD] message sent");
        return true;
    } catch (e) { logger.warn(`[DISCORD] ${e.message}`); return false; }
}

// Register factor bridge as a tool (enables factor_* routing in AI)
tools.factor = async ({ tool, params = {} }) => {
    logger.info(`[TOOL:factor] ${tool}`);
    try { return await factorBridge.callTool(tool, params); }
    catch (e) { return { error: e.message }; }
};

// ─── Express ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "10mb" }));

// Health
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        agent: "0xpiclaw.eth",
        version: "2.0.0",
        uptime: process.uptime(),
        model: CONFIG.minimaxModel,
        auth: { oauth: MiniMaxOAuth.hasOAuth(), expired: MiniMaxOAuth.hasOAuth() ? MiniMaxOAuth.isExpired() : null, fallbackKey: !!_minimaxKey },
        factorMcp: factorBridge.ready,
    });
});

// OAuth endpoints
app.post("/auth/minimax", async (req, res) => {
    try {
        const r = await MiniMaxOAuth.startAuth();
        res.json({ success: true, user_code: r.user_code, verification_uri: r.verification_uri });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get("/auth/minimax/status", (req, res) => {
    if (MiniMaxOAuth.hasOAuth()) return res.json({ authenticated: true, expired: MiniMaxOAuth.isExpired() });
    if (MiniMaxOAuth.pendingAuth) return res.json({ authenticated: false, pending: MiniMaxOAuth.pendingAuth.polling, completed: MiniMaxOAuth.pendingAuth.completed || false });
    res.json({ authenticated: false, pending: false, fallbackKey: !!_minimaxKey });
});
app.post("/auth/minimax/refresh", async (req, res) => {
    try { const t = await MiniMaxOAuth.refreshToken(); res.json({ success: true, expires: t.expires }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Chat (MiniMax AI with tool loop)
app.post("/chat", async (req, res) => {
    const { message, chatId = "default" } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    try {
        const result = await ai.chat(message, chatId);
        res.json(result);
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: e.message });
    }
});
// Discord test
app.post("/discord/test", async (req, res) => {
    const ok = await sendDiscordMessage("0xpiclaw.eth online.");
    res.json({ success: ok });
});

app.post("/chat/clear", (req, res) => {
    const { chatId = "default" } = req.body;
    ai.clearHistory(chatId);
    res.json({ success: true });
});

// Factor MCP proxy
app.post("/factor", async (req, res) => {
    const { tool, params = {} } = req.body;
    if (!tool) return res.status(400).json({ error: "tool required" });
    try { res.json(await factorBridge.callTool(tool, params)); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/factor/tools", async (req, res) => {
    try { res.json({ tools: await factorBridge.listTools() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Start ──────────────────────────────────────────────────────────────────
app.listen(CONFIG.port, "0.0.0.0", async () => {
    logger.info(`0xpiclaw.eth running on :${CONFIG.port}`);
    logger.info(`Auth: OAuth=${MiniMaxOAuth.hasOAuth()}, Key=${!!_minimaxKey}`);
    const ok = await factorBridge.start();
    logger.info(`Factor MCP: ${ok ? "connected" : "not available"}`);
});
