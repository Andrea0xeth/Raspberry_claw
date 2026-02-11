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

const AI_PROVIDER_FILE = "/opt/openclaw/.ai_provider";
let _openrouterKey = process.env.OPENROUTER_API_KEY || "";
try { const k = (await fs.readFile("/opt/openclaw/.openrouter_key", "utf8")).trim(); if (k) _openrouterKey = k; } catch {}

async function getAiProvider() {
    try { return (await fs.readFile(AI_PROVIDER_FILE, "utf8")).trim().toLowerCase() || "minimax"; } catch {}
    return (process.env.AI_PROVIDER || "minimax").toLowerCase();
}
async function setAiProvider(provider) {
    const p = (provider || "minimax").toLowerCase();
    if (p !== "minimax" && p !== "openrouter") throw new Error("AI provider must be minimax or openrouter");
    await fs.writeFile(AI_PROVIDER_FILE, p, "utf8");
    return p;
}

const CONFIG = {
    port: parseInt(process.env.OPENCLAW_PORT || "3100"),
    minimaxModel: process.env.MINIMAX_MODEL || "MiniMax-M2.1",
    minimaxUrl: `${MINIMAX_BASE_URL}/anthropic/v1/messages`,
    openrouterUrl: process.env.OPENROUTER_URL || "https://openrouter.ai/api/v1/chat/completions",
    openrouterModel: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
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
- toolName = the actual tool (e.g. factor_get_config, factor_get_owned_vaults, shell). NOT the word "name".
- jsonObject = a JSON object, use {} for no params. Examples: [TOOL_CALL:factor_get_config:{}] or [TOOL_CALL:shell:{"command":"vcgencmd measure_temp"}]
- For shell: [TOOL_CALL:shell:{"command":"your bash command"}] (optional: "timeout": 30000 ms). You run on the Pi; use shell to run OS commands, read files, check services, etc.
- To add new knowledge: add_skill (create from content), add_skill_from_path (import .md from Pi filesystem), add_skill_from_url (fetch from URL). Then reload_skills so it applies. Use list_skills to see what skills you have (optionally includeContent or previewLines).
- To split work into one-shot sub-tasks (research, parallel checks): run_subagents with tasks array. Each task runs with your same skills and tools; you get back aggregated results. Use only when it clearly helps (e.g. "one searches, one checks vaults, one summarizes").
- For real-time DeFi yield by chain/asset/protocol: yield_opportunities (chain?, symbol?, project?, stablecoinOnly?, minTvlUsd?, limit?). Use project for protocol (e.g. aave-v3, compound-v3). Data from DefiLlama Yields.
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
        let reasoning = data.reasoning_content || (Array.isArray(data.reasoning_details) && data.reasoning_details.map(d => d.text || d.content || "").join("\n")) || "";
        if (!text && retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            data = await doCall();
            text = data.content?.map(c => c.text || "").join("") || "";
            if (!reasoning) reasoning = data.reasoning_content || (Array.isArray(data.reasoning_details) && data.reasoning_details.map(d => d.text || d.content || "").join("\n")) || "";
        }
        if (!reasoning && text) {
            const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
            if (thinkMatch) {
                reasoning = thinkMatch[1].trim();
                text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
            }
        }
        const usage = data.usage || {};
        if (!text) usage._error = data.error?.message || "empty response";
        return { text, reasoning: reasoning || null, usage };
    }

    async callOpenRouter(systemPrompt, messages, retries = 1) {
        if (!_openrouterKey) throw new Error("OpenRouter not configured. Set OPENROUTER_API_KEY or create /opt/openclaw/.openrouter_key");
        const openRouterMessages = [{ role: "system", content: systemPrompt }, ...messages];
        const body = {
            model: CONFIG.openrouterModel,
            messages: openRouterMessages,
            temperature: 0.7,
            max_tokens: 8192,
        };
        const doCall = async () => {
            if (AIEngine._apiLock) await AIEngine._apiLock;
            let _resolve;
            AIEngine._apiLock = new Promise(r => { _resolve = r; });
            try {
                const response = await axios.post(CONFIG.openrouterUrl, body, {
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${_openrouterKey}` },
                });
                return response.data;
            } finally { _resolve(); AIEngine._apiLock = null; }
        };
        let data = await doCall();
        const choice = data.choices?.[0];
        let text = choice?.message?.content || "";
        let reasoning = choice?.message?.reasoning || "";
        const usage = data.usage || {};
        if (!text && retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            data = await doCall();
            const c2 = data.choices?.[0];
            text = c2?.message?.content || "";
            if (!reasoning) reasoning = c2?.message?.reasoning || "";
        }
        if (!reasoning && text) {
            const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
            if (thinkMatch) {
                reasoning = thinkMatch[1].trim();
                text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
            }
        }
        if (!text) usage._error = data.error?.message || "empty response";
        return { text, reasoning: reasoning || null, usage };
    }

    async chat(message, chatId = "default", systemPrompt = SYSTEM_PROMPT, { maxRounds = 10 } = {}) {
        const provider = await getAiProvider();
        const needsMinimax = provider === "minimax";
        if (needsMinimax && !MiniMaxOAuth.getBearer()) throw new Error("Not authenticated. Use /auth/minimax");
        if (provider === "openrouter" && !_openrouterKey) throw new Error("OpenRouter not configured. Set OPENROUTER_API_KEY or add /opt/openclaw/.openrouter_key");
        this.addMessage(chatId, "user", message);
        const history = this.getHistory(chatId);
        logger.info(`[AI] Chat [${chatId}] (${provider}): "${message}" (${history.length} msgs)`);

        const callApi = (sys, msgs) => provider === "openrouter" ? this.callOpenRouter(sys, msgs) : this.callMiniMax(sys, msgs);
        const engineLabel = provider === "openrouter" ? "openrouter" : "minimax";
        const modelLabel = provider === "openrouter" ? CONFIG.openrouterModel : CONFIG.minimaxModel;

        try {
            let result = await callApi(systemPrompt, history.map(m => ({ role: m.role, content: m.content })));
            let totalTokens = (result.usage.prompt_tokens || result.usage.input_tokens || 0) + (result.usage.completion_tokens || result.usage.output_tokens || 0);

            // Tool call loop
            for (let round = 0; round < maxRounds; round++) {
                const tc = extractToolCall(result.text);
                if (!tc) break;
                logger.info(`[AI] Tool: ${tc.toolName}(${tc.params})`);

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
                this.addMessage(chatId, "user", `[TOOL_RESULT:${tc.toolName}]\n${resultStr}`);

                try {
                    result = await callApi(systemPrompt, this.getHistory(chatId).map(m => ({ role: m.role, content: m.content })));
                    totalTokens += (result.usage.prompt_tokens || result.usage.input_tokens || 0) + (result.usage.completion_tokens || result.usage.output_tokens || 0);
                } catch (e) {
                    result = { text: `Tool ${tc.toolName} result: ${resultStr.substring(0, 300)}`, usage: {} };
                    break;
                }
            }

            // Clean leftover tool calls
            let clean = result.text || "";
            while (true) { const l = extractToolCall(clean); if (!l) break; clean = clean.replace(l.fullMatch, ""); }
            clean = clean.trim() || "Empty response from AI.";

            this.addMessage(chatId, "assistant", clean);
            logger.info(`[AI] Response: ${clean} (${totalTokens} tokens)`);
            return { success: true, response: clean, reasoning: result.reasoning || null, engine: engineLabel, model: modelLabel, tokens: { total: totalTokens } };
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
        const factorEnv = { ...process.env };
        if (process.env.FACTOR_ENVIRONMENT) factorEnv.FACTOR_ENVIRONMENT = process.env.FACTOR_ENVIRONMENT;
        if (process.env.SIMULATION_MODE !== undefined) factorEnv.SIMULATION_MODE = process.env.SIMULATION_MODE;
        this.process = spawn("node", [this.mcpPath], { stdio: ["pipe", "pipe", "pipe"], env: factorEnv });
        logger.info("[FACTOR] MCP env: " + (factorEnv.FACTOR_ENVIRONMENT ? "FACTOR_ENVIRONMENT=" + factorEnv.FACTOR_ENVIRONMENT : "") + (factorEnv.SIMULATION_MODE !== undefined ? " SIMULATION_MODE=" + factorEnv.SIMULATION_MODE : " (simulation from config file)"));

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
        this.process.stderr.on("data", (d) => { const m = d.toString().trim(); if (m) logger.info(`[FACTOR:stderr] ${m}`); });
        this.process.on("exit", (code) => { logger.warn(`[FACTOR] exited ${code}`); this.ready = false; setTimeout(() => this.start(), 5000); });

        try {
            const init = await this.send("initialize", {
                protocolVersion: "2024-11-05", capabilities: {},
                clientInfo: { name: "0xpiclaw.eth", version: "2.0.0" },
            });
            logger.info(`[FACTOR] init OK: ${JSON.stringify(init)}`);
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
        logger.info(`[FACTOR] ${name}(${JSON.stringify(args)})`);
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
    try {
        const result = await factorBridge.callTool(tool, params);
        if (appendAgentJournal) await appendAgentJournal({ type: "tool_call", name: tool, result: typeof result === "object" ? JSON.stringify(result) : String(result) });
        return result;
    } catch (e) { return { error: e.message }; }
};

// Shell tool: run a command on the Pi (runs as same user as OpenClaw, e.g. openclaw)
tools.shell = async ({ command, timeout = 30000 }) => {
    if (!command || typeof command !== "string") return { error: "command (string) required" };
    logger.info(`[TOOL:shell] ${command.substring(0, 120)}`);
    return new Promise((resolve) => {
        const child = spawn("sh", ["-c", command], {
            timeout: Math.min(Math.max(Number(timeout) || 30000, 1000), 60000),
            maxBuffer: 512 * 1024,
            env: process.env,
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (d) => { stdout += d.toString(); });
        child.stderr?.on("data", (d) => { stderr += d.toString(); });
        child.on("error", (e) => resolve({ error: e.message, stdout, stderr }));
        child.on("close", (code, signal) => {
            const out = { stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? -1, signal: signal || null };
            if (appendAgentJournal) appendAgentJournal({ type: "tool_call", name: "shell", result: JSON.stringify(out).slice(0, 500) });
            resolve(out);
        });
    });
};

// Add a new skill (markdown file) so you can extend your own instructions. Reload after adding.
tools.add_skill = async ({ filename, content }) => {
    if (!filename || typeof filename !== "string") return { error: "filename (string) required" };
    if (typeof content !== "string") return { error: "content (string) required" };
    const base = path.basename(filename);
    if (!base.endsWith(".md") || base !== filename) return { error: "filename must be a .md basename (e.g. my-skill.md)" };
    const filePath = path.join(SKILLS_DIR, base);
    try {
        await fs.writeFile(filePath, content, "utf8");
        logger.info("[TOOL:add_skill] wrote " + base);
        return { success: true, path: filePath, filename: base };
    } catch (e) {
        return { error: e.message };
    }
};

// Reload skills from disk and update your system prompt (new skills apply to next turns).
tools.reload_skills = async () => {
    try {
        const skillText = await loadSkills();
        SYSTEM_PROMPT = BASE_PROMPT + (skillText ? "\n\n" + skillText : "");
        const files = await fs.readdir(SKILLS_DIR).catch(() => []);
        const count = files.filter(f => f.endsWith(".md")).length;
        logger.info("[TOOL:reload_skills] reloaded " + count + " skills");
        return { success: true, skillCount: count, message: "Skills reloaded; next messages use updated prompt." };
    } catch (e) {
        return { error: e.message };
    }
};

// List current skills (files in skills dir). Optionally include content or first lines.
tools.list_skills = async ({ includeContent = false, previewLines = 0 } = {}) => {
    try {
        const files = await fs.readdir(SKILLS_DIR).catch(() => []);
        const md = files.filter(f => f.endsWith(".md")).sort();
        const skills = [];
        for (const f of md) {
            const filePath = path.join(SKILLS_DIR, f);
            const stat = await fs.stat(filePath).catch(() => null);
            const entry = { filename: f, size: stat?.size };
            if (includeContent) {
                const content = await fs.readFile(filePath, "utf8").catch(() => "");
                entry.content = content;
            } else if (Number(previewLines) > 0) {
                const content = await fs.readFile(filePath, "utf8").catch(() => "");
                entry.preview = content.split("\n").slice(0, Number(previewLines)).join("\n");
            }
            skills.push(entry);
        }
        return { skills, count: skills.length };
    } catch (e) {
        return { error: e.message, skills: [], count: 0 };
    }
};

const SKILL_IMPORT_ALLOWED_ROOTS = [
    path.resolve("/opt/openclaw"),
    path.resolve("/data"),
    path.resolve("/home/openclaw"),
    path.resolve("/home/pi"),
];
function resolveSkillPathAllowed(fullPath) {
    const resolved = path.resolve(fullPath);
    for (const root of SKILL_IMPORT_ALLOWED_ROOTS) {
        if (resolved === root || resolved.startsWith(root + path.sep)) return resolved;
    }
    return null;
}

// Import a skill from a file path on the Pi (allowed: /opt/openclaw, /data, /home/openclaw, /home/pi).
tools.add_skill_from_path = async ({ path: filePath, filename: asFilename }) => {
    if (!filePath || typeof filePath !== "string") return { error: "path (string) required" };
    const resolved = resolveSkillPathAllowed(filePath);
    if (!resolved) return { error: "Path not allowed (use a path under /opt/openclaw, /data, /home/openclaw, /home/pi)" };
    try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) return { error: "Not a file" };
        const content = await fs.readFile(resolved, "utf8");
        const base = asFilename && asFilename.endsWith(".md") ? path.basename(asFilename) : path.basename(resolved);
        const dest = path.join(SKILLS_DIR, base);
        await fs.writeFile(dest, content, "utf8");
        logger.info("[TOOL:add_skill_from_path] imported " + resolved + " as " + base);
        return { success: true, filename: base, from: resolved };
    } catch (e) {
        return { error: e.message };
    }
};

// Import a skill from a URL (fetch markdown/text; max 150KB, timeout 15s). Optional filename.
tools.add_skill_from_url = async ({ url, filename }) => {
    if (!url || typeof url !== "string") return { error: "url (string) required" };
    const maxSize = 150 * 1024;
    const timeout = 15000;
    try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), timeout);
        const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "OpenClaw/2.0" } });
        clearTimeout(to);
        if (!res.ok) return { error: "HTTP " + res.status };
        const text = await res.text();
        if (text.length > maxSize) return { error: "Content too large (max 150KB)" };
        const base = filename && String(filename).endsWith(".md") ? path.basename(filename) : (path.basename(new URL(url).pathname) || "imported.md");
        const safe = base.endsWith(".md") ? base : (base + ".md");
        const dest = path.join(SKILLS_DIR, safe);
        await fs.writeFile(dest, text, "utf8");
        logger.info("[TOOL:add_skill_from_url] imported " + url + " as " + safe);
        return { success: true, filename: safe, url };
    } catch (e) {
        return { error: e.message };
    }
};

// Real-time DeFi yield opportunities (DefiLlama Yields API). Chain-based, no API key.
tools.yield_opportunities = async ({ chain, symbol, project, stablecoinOnly = false, minTvlUsd = 0, limit = 25 }) => {
    const timeout = 15000;
    try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), timeout);
        const res = await fetch("https://yields.llama.fi/pools", { signal: controller.signal, headers: { "Accept": "application/json" } });
        clearTimeout(to);
        if (!res.ok) return { error: "yields.llama.fi HTTP " + res.status };
        const json = await res.json();
        if (json.status !== "success" || !Array.isArray(json.data)) return { error: "Invalid response from yields API" };
        const projectParts = project ? String(project).split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : [];
        const projectMatch = (p) => !projectParts.length || (p.project && projectParts.some(part => p.project.toLowerCase().includes(part)));
        let list = json.data.filter((p) => (p.apy != null && Number(p.apy) >= 0 && (!chain || (p.chain && p.chain.toLowerCase() === String(chain).toLowerCase())) && (!symbol || (p.symbol && p.symbol.toUpperCase().includes(String(symbol).toUpperCase()))) && projectMatch(p) && (!stablecoinOnly || p.stablecoin === true) && (Number(p.tvlUsd) || 0) >= Number(minTvlUsd) || 0));
        list.sort((a, b) => (Number(b.apy) || 0) - (Number(a.apy) || 0));
        const top = list.slice(0, Math.min(Number(limit) || 25, 50));
        const pools = top.map((p) => ({
            chain: p.chain,
            project: p.project,
            symbol: p.symbol,
            apy: p.apy,
            apyBase: p.apyBase,
            apyReward: p.apyReward,
            tvlUsd: p.tvlUsd,
            stablecoin: p.stablecoin,
            ilRisk: p.ilRisk,
        }));
        return { source: "yields.llama.fi", chain: chain || "all", project: project || "all", count: pools.length, pools };
    } catch (e) {
        return { error: e.message };
    }
};

// One-shot subagents: run multiple tasks with same skills/tools, aggregate results. Use only when splitting improves the outcome (research, parallel checks). Max 5 tasks, sequential execution.
tools.run_subagents = async ({ tasks, maxRounds = 5 }) => {
    if (!Array.isArray(tasks) || tasks.length === 0) return { error: "tasks (non-empty array) required. Each item: { id?, task }." };
    if (tasks.length > 5) return { error: "Max 5 tasks per run_subagents." };
    const ts = Date.now();
    const results = [];
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const taskMsg = typeof t === "string" ? t : (t.task || t.message);
        const id = (typeof t === "object" && t.id) ? String(t.id) : String(i + 1);
        if (!taskMsg) { results.push({ id, task: "", response: "", error: "Missing task text" }); continue; }
        const chatId = `subagent-${ts}-${id}`;
        try {
            const out = await ai.chat(taskMsg, chatId, SYSTEM_PROMPT, { maxRounds: Math.min(Number(maxRounds) || 5, 10) });
            results.push({ id, task: taskMsg.substring(0, 200), response: out.response || "", tokens: out.tokens });
        } catch (e) {
            results.push({ id, task: taskMsg.substring(0, 200), response: "", error: e.message });
        }
        ai.clearHistory(chatId);
    }
    logger.info("[TOOL:run_subagents] completed " + results.length + " tasks");
    if (appendAgentJournal) await appendAgentJournal({ type: "tool_call", name: "run_subagents", result: JSON.stringify({ count: results.length, ids: results.map(r => r.id) }) });
    return { results };
};

// ─── Express ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "10mb" }));

// Dashboard: API routes + optional journal append (for Agents tab)
let appendAgentJournal = null;
try {
    const dash = await import(path.join(__dirname, "dashboard-routes.js"));
    dash.registerDashboardRoutes(app);
    appendAgentJournal = dash.appendAgentJournal;
} catch (e) {
    logger.warn("[DASHBOARD] Routes not loaded: " + e.message);
}
const PUBLIC_DIR = path.join(__dirname, "..", "public");
function sendDashboardHtml(req, res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const htmlPath = path.join(PUBLIC_DIR, "index.html");
    res.sendFile(htmlPath, (err) => {
        if (err) {
            logger.warn("[DASHBOARD] sendFile failed: " + err.message);
            res.status(err.status || 500).send("Dashboard not found. Check PUBLIC_DIR: " + PUBLIC_DIR);
        }
    });
}
app.get("/dashboard", sendDashboardHtml);
app.get("/dashboard/", sendDashboardHtml);
app.use("/dashboard", express.static(PUBLIC_DIR, { index: false }));
app.get("/", (req, res) => {
    if (req.accepts("html")) return res.redirect(302, "/dashboard?v=2");
    res.json({ agent: "0xpiclaw.eth", dashboard: "/dashboard" });
});

// Health
app.get("/health", async (req, res) => {
    const provider = await getAiProvider();
    res.json({
        status: "ok",
        agent: "0xpiclaw.eth",
        version: "2.0.0",
        uptime: process.uptime(),
        aiProvider: provider,
        model: provider === "openrouter" ? CONFIG.openrouterModel : CONFIG.minimaxModel,
        auth: { oauth: MiniMaxOAuth.hasOAuth(), expired: MiniMaxOAuth.hasOAuth() ? MiniMaxOAuth.isExpired() : null, fallbackKey: !!_minimaxKey },
        openrouterConfigured: !!_openrouterKey,
        factorMcp: factorBridge.ready,
    });
});

// AI provider switch (minimax | openrouter)
app.get("/api/ai-provider", async (req, res) => {
    try {
        const provider = await getAiProvider();
        res.json({
            provider,
            minimaxReady: !!MiniMaxOAuth.getBearer(),
            openrouterReady: !!_openrouterKey,
            openrouterModel: CONFIG.openrouterModel,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.post("/api/ai-provider", async (req, res) => {
    const { provider } = req.body;
    if (!provider) return res.status(400).json({ error: "provider required (minimax or openrouter)" });
    try {
        const p = await setAiProvider(provider);
        logger.info("[AI] Provider switched to: " + p);
        res.json({ success: true, provider: p });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
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
        if (appendAgentJournal) await appendAgentJournal({ type: "chat", role: "user", content: message });
        const result = await ai.chat(message, chatId);
        if (appendAgentJournal) await appendAgentJournal({ type: "chat", role: "assistant", content: result.response, reasoning: result.reasoning, tokens: result.tokens });
        res.json(result);
    } catch (e) {
        if (appendAgentJournal) await appendAgentJournal({ type: "error", message: e.message });
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

// Cron: hourly yield optimizer (Aave vs Compound USDC on Arbitrum, rebalance vault)
const CRON_SECRET = process.env.CRON_SECRET || "";
const YIELD_OPTIMIZER_PROMPT = `Run this task once:

1. Call yield_opportunities with chain "Arbitrum", symbol "USDC", project "aave-v3,compound-v3", limit 15. Compare APY for USDC on Aave V3 vs Compound V3.

2. Using vault 0xbad0d504b0b03443547e65ba9bf5ca47ecf644dc (Factor MCP): if Compound V3 USDC APY is higher than Aave V3, move funds from Aave to Compound; if Aave is higher, move from Compound to Aave. Use factor_get_vault_info and factor_execute_manager (or factor_build_strategy / factor_simulate_strategy / factor_execute_strategy) as needed. Only execute rebalance if the APY difference justifies it and you have the right adapters. Reply with a short summary: rates found, action taken (or skipped), and reason.`;

app.post("/cron/yield-optimize", async (req, res) => {
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith("Bearer ") ? auth.slice(7) : (req.body?.secret || req.query?.secret);
    if (!CRON_SECRET || token !== CRON_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const chatId = "cron-yield-optimize";
    try {
        logger.info("[CRON] yield-optimize started");
        if (appendAgentJournal) await appendAgentJournal({ type: "chat", role: "user", content: "[cron] " + YIELD_OPTIMIZER_PROMPT });
        const result = await ai.chat(YIELD_OPTIMIZER_PROMPT, chatId, SYSTEM_PROMPT, { maxRounds: 15 });
        if (appendAgentJournal) await appendAgentJournal({ type: "chat", role: "assistant", content: result.response, tokens: result.tokens });
        logger.info("[CRON] yield-optimize done");
        res.json({ success: true, response: result.response, tokens: result.tokens });
    } catch (e) {
        logger.error("[CRON] yield-optimize error: " + e.message);
        if (appendAgentJournal) await appendAgentJournal({ type: "error", message: e.message });
        res.status(500).json({ success: false, error: e.message });
    }
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
    const provider = await getAiProvider();
    logger.info(`0xpiclaw.eth running on :${CONFIG.port}`);
    logger.info(`AI provider: ${provider} | MiniMax: OAuth=${MiniMaxOAuth.hasOAuth()}, Key=${!!_minimaxKey} | OpenRouter: ${!!_openrouterKey}`);
    const ok = await factorBridge.start();
    logger.info(`Factor MCP: ${ok ? "connected" : "not available"}`);
});
