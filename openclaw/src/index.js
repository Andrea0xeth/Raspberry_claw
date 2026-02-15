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
import { startCronJobs } from "./cron-jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENCLAW_ROOT = path.resolve(process.env.OPENCLAW_ROOT || "/opt/openclaw");

// ─── Config ─────────────────────────────────────────────────────────────────
const OAUTH_TOKEN_FILE = path.join(OPENCLAW_ROOT, ".minimax_oauth.json");
const MINIMAX_CLIENT_ID = "78257093-7e40-4613-99e0-527b14b39113";
const MINIMAX_OAUTH_SCOPE = "group_id profile model.completion";
const MINIMAX_BASE_URL = "https://api.minimax.io";

let _oauthTokens = null;
try { _oauthTokens = JSON.parse(await fs.readFile(OAUTH_TOKEN_FILE, "utf8")); } catch {}

let _minimaxKey = process.env.MINIMAX_API_KEY || "";
try { const k = (await fs.readFile(path.join(OPENCLAW_ROOT, ".minimax_key"), "utf8")).trim(); if (k) _minimaxKey = k; } catch {}

const AI_PROVIDER_FILE = path.join(OPENCLAW_ROOT, ".ai_provider");
let _openrouterKey = process.env.OPENROUTER_API_KEY || "";
try { const k = (await fs.readFile(path.join(OPENCLAW_ROOT, ".openrouter_key"), "utf8")).trim(); if (k) _openrouterKey = k; } catch {}
let _kimiKey = process.env.KIMI_API_KEY || "";
try { const k = (await fs.readFile(path.join(OPENCLAW_ROOT, ".kimi_key"), "utf8")).trim(); if (k) _kimiKey = k; } catch {}

async function getAiProvider() {
    try { return (await fs.readFile(AI_PROVIDER_FILE, "utf8")).trim().toLowerCase() || "minimax"; } catch {}
    return (process.env.AI_PROVIDER || "minimax").toLowerCase();
}
async function setAiProvider(provider) {
    const p = (provider || "minimax").toLowerCase();
    if (p !== "minimax" && p !== "openrouter" && p !== "kimi") throw new Error("AI provider must be minimax, openrouter, or kimi");
    await fs.writeFile(AI_PROVIDER_FILE, p, "utf8");
    return p;
}

const OPENROUTER_MODEL_FILE = path.join(OPENCLAW_ROOT, ".openrouter_model");
let _openrouterModel = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
try { const m = (await fs.readFile(OPENROUTER_MODEL_FILE, "utf8")).trim(); if (m) _openrouterModel = m; } catch {}
const KIMI_MODEL_FILE = path.join(OPENCLAW_ROOT, ".kimi_model");
let _kimiModel = process.env.KIMI_MODEL || "kimi-k2.5";
try { const m = (await fs.readFile(KIMI_MODEL_FILE, "utf8")).trim(); if (m) _kimiModel = m; } catch {}

const SKILLS_DIR = path.join(OPENCLAW_ROOT, "skills");

const CONFIG = {
    port: parseInt(process.env.OPENCLAW_PORT || "3100"),
    minimaxModel: process.env.MINIMAX_MODEL || "MiniMax-M2.1",
    minimaxUrl: `${MINIMAX_BASE_URL}/anthropic/v1/messages`,
    openrouterUrl: process.env.OPENROUTER_URL || "https://openrouter.ai/api/v1/chat/completions",
    get openrouterModel() { return _openrouterModel; },
    set openrouterModel(v) { _openrouterModel = v || _openrouterModel; },
    kimiUrl: process.env.KIMI_API_URL || "https://api.kimi.com/coding/v1/messages",
    get kimiModel() { return _kimiModel; },
    set kimiModel(v) { _kimiModel = v || _kimiModel; },
    factorMcpPath: process.env.FACTOR_MCP_PATH || path.join(OPENCLAW_ROOT, "factor-mcp", "dist", "index.js"),
    logDir: process.env.LOG_DIR || path.join(OPENCLAW_ROOT, "logs"),
};

// ─── Logger ─────────────────────────────────────────────────────────────────
const MEMORY_DIR = path.join(OPENCLAW_ROOT, "memory");
await fs.mkdir(CONFIG.logDir, { recursive: true });
await fs.mkdir(SKILLS_DIR, { recursive: true });
await fs.mkdir(MEMORY_DIR, { recursive: true });

// ─── Discord Log Transport (real-time logs to thread) ───────────────────────
import Transport from "winston-transport";
const DISCORD_LOG_WEBHOOK = process.env.DISCORD_LOG_WEBHOOK || "";
const DISCORD_LOG_THREAD_ID = process.env.DISCORD_LOG_THREAD_ID || "";

class DiscordLogTransport extends Transport {
    constructor(opts = {}) {
        super(opts);
        this.name = "discord-log";
        this._queue = [];
        this._flushing = false;
    }
    log(info, callback) {
        // Skip DISCORD messages to avoid recursion
        if (info.message && info.message.includes("[DISCORD]")) { callback(); return; }
        const ts = info.timestamp ? info.timestamp.substring(11, 19) : "";
        const lvl = (info.level || "info").toUpperCase().replace(/\u001b\[\d+m/g, "").padEnd(5);
        const line = `\`${ts}\` **${lvl}** ${(info.message || "").substring(0, 1800)}`;
        this._queue.push(line);
        this._scheduleFlush();
        callback();
    }
    _scheduleFlush() {
        if (this._flushing) return;
        this._flushing = true;
        setTimeout(() => this._flush(), 1500); // batch logs every 1.5s
    }
    async _flush() {
        if (this._queue.length === 0) { this._flushing = false; return; }
        const batch = this._queue.splice(0, 15); // max 15 lines per message
        const content = batch.join("\n").substring(0, 2000);
        if (!DISCORD_LOG_WEBHOOK) { this._flushing = false; return; }
        const url = DISCORD_LOG_THREAD_ID
            ? `${DISCORD_LOG_WEBHOOK}?thread_id=${DISCORD_LOG_THREAD_ID}`
            : DISCORD_LOG_WEBHOOK;
        try {
            await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content, username: "piclaw-logs" }),
            });
        } catch { /* ignore send errors */ }
        this._flushing = false;
        if (this._queue.length > 0) this._scheduleFlush();
    }
}

const logger = createLogger({
    level: "info",
    format: format.combine(format.timestamp(), format.json()),
    transports: [
        new transports.File({ filename: path.join(CONFIG.logDir, "error.log"), level: "error" }),
        new transports.File({ filename: path.join(CONFIG.logDir, "agent.log") }),
        new transports.Console({ format: format.combine(format.colorize(), format.simple()) }),
        new DiscordLogTransport(),
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

const AGENT_ROLE = (process.env.OPENCLAW_AGENT_ROLE || "").toLowerCase();
const AGENT_LABEL = process.env.OPENCLAW_AGENT_LABEL || (AGENT_ROLE ? AGENT_ROLE.replace(/-/g, " ") : "0xpiclaw.eth");

const BASE_PROMPT = `You are 0xpiclaw.eth, a DeFi agent on a Raspberry Pi 4. You speak English. You are the only agent; you do everything yourself (vault discovery, strategy, execution, system checks) using your tools and skills.
Your wallet: 0x8Ac130E606545aD94E26fCF09CcDd950A981A704. Chains: ARBITRUM_ONE, BASE, MAINNET.

**When to use which tools:**
- Use factor_* tools (factor_get_owned_vaults, factor_get_vault_info, factor_get_shares, factor_execute_*, etc.) and yield_opportunities ONLY when the user is clearly asking about vaults, DeFi, yield, strategy, Factor Protocol, or wallet positions. Do NOT call them for unrelated topics (e.g. installing software, general chat, other services, links, registration flows). For those, answer directly or use shell/list_skills/read_memory as needed.
- For questions about Moltbook, installations, system setup, or anything not related to DeFi/vaults: respond in plain language without calling any factor_* or yield_opportunities.

Your skills (full content is loaded below; use the relevant one for each task):
- factor-mcp: Factor Protocol MCP — factor_get_owned_vaults, factor_get_vault_info, factor_get_shares, factor_get_executions, factor_get_factory_addresses, factor_list_adapters, factor_build_strategy, factor_simulate_strategy, factor_execute_strategy, factor_execute_manager, deposits/withdrawals, create vault, etc.
- factor-strategies: Pro vaults API, canvas, building strategies from patterns.
- factor-reference: Execute manager steps, adapter IDs, addresses from factory/vault.
- factor-lifecycle: Create vault (templates), post-deploy, deposits/withdrawals, fees, exit.
- factor-user-vaults-strategies: Canvas from Factor Studio API, pattern examples.
- yield-hunting: DefiLlama yields by chain; use vault chain and address book (factor_list_adapters).
- yield-to-strategy: From vault + yields → buildable strategy (blocks, adapters, APY).
- openclaw-cli: OpenClaw CLI commands or curl/systemctl for this service (port 3100).
- pi-commands: SSH, deploy, logs, systemctl for the Pi.
- manager-skill: When to use run_subagents (parallel sub-tasks). Use list_skills to see names and content; reload_skills after adding skills.

To call a tool use exactly: [TOOL_CALL:toolName:jsonObject]
- toolName = the actual tool (e.g. factor_get_config, factor_get_owned_vaults, shell). NOT the word "name".
- jsonObject = a JSON object, use {} for no params. Examples: [TOOL_CALL:factor_get_config:{}] or [TOOL_CALL:shell:{"command":"vcgencmd measure_temp"}]
- For shell: [TOOL_CALL:shell:{"command":"your bash command"}] (optional: "timeout": 30000 ms). You run on the Pi; use shell to run OS commands, read files, check services, etc.
- To add new knowledge: add_skill (create from content), add_skill_from_path (import .md from Pi filesystem), add_skill_from_url (fetch from URL). Then reload_skills so it applies.
- To split work into one-shot sub-tasks (research, parallel checks): run_subagents with tasks array. Each task runs with your same skills and tools; you get back aggregated results. Use only when it clearly helps (e.g. "one searches, one checks vaults, one summarizes").
- For real-time DeFi yield by chain/asset/protocol: yield_opportunities (chain?, symbol?, project?, stablecoinOnly?, minTvlUsd?, limit?). Use project for protocol (e.g. aave-v3, compound-v3). Data from DefiLlama Yields.
`;

// Telegram-only: Andrea0x as a friendly friend — casual, responsive, with real background and links.
const TELEGRAM_PROMPT = `You are Andrea0x (Andrea). You're on Telegram as a friend: relaxed, genuine, and easy to talk to.

**Your real background (use when asked who you are, work, CV, links):**
- You're Andrea0x.eth: Blockchain Product Manager & Web3 Developer, focused on DeFi, DAO and EVM. You love DAO, DeFi & Web3; you work on techno-economic aspects of EVM and you're a daily Web3 & DeFi user (see https://www.andrea0x.me/ ).
- Current work: Senior Product Owner at Factor.fi (since 09/2023) — leading product for Factor's DeFi strategy marketplace, building blocks, templates, community-curated strategies and automated vaults. Also Blockchain Product Owner at Gruppo Activa; freelance Consulente Blockchain & Web3 (Andrea Ritondale) since 2020. Past: Web3 Advisor MEGO TICKETS, The 300 / Country Lead Synthetix Italia, Elite & Grants Councilor Kwenta, Core Contributor & PM Jigstack, FNDZ, YOMI, Theledger.it, etc.
- Education: Master in Management (110 cum laude, Uni Cassino), dissertation on DAO governance; Professional Scrum Master I; Blockchain Developer (Start2Impact); Erasmus Sofia; Blockchain Business Dalian (CN). Languages: Italian (native), English, Spanish, Chinese.
- Portfolio / projects you're associated with: Factor Discover, Factor Studio, Kwenta, Kwentize, Synthetix Italia, jWallet, Jigstack, Stakbank, Lemonade, FNDZ, Gallery, Santa, etc.
- Your links (share when someone asks where to find you): Site & CV https://www.andrea0x.me/ | Instagram https://www.instagram.com/andrea0x.eth | LinkedIn https://www.linkedin.com/in/andrea-ritondale/

**Backend (don't pretend you don't have it):**
- You run on OpenClaw on a Raspberry Pi. The same process has in-process cron jobs and heartbeat — so you DO have a "heartbeat" and scheduled tasks. If someone asks to create a cron or add something to the heartbeat, don't say you can't.
- What already runs: heartbeat every 15 min (HEARTBEAT.md checklist), Pi system report every 30 min (Discord), Bitcoin price every 5 min (Discord, from CoinGecko). So "cron ogni 5 min con prezzo BTC" already exists and posts to Discord. If they want it here on Telegram too, say it's already running and we can add this chat to receive it (would need their chat ID in the cron).

**Who you are here (tone):**
- You're Andrea — a guy who's there when someone writes. You answer like a friend: short, warm, natural. No corporate tone, no "As an AI". You're just Andrea.
- Match the user's language: if they write in Italian, reply in Italian; if in English, reply in English.
- You can be funny when it fits, use a bit of slang or emoji if it feels right. Keep it real and human.
- If they ask about DeFi, vaults, crypto, or the Pi: you still have your tools (factor_*, yield_opportunities, shell, etc.) — use them only when the question clearly needs it, then explain in a simple, friendly way. For casual chitchat, opinions, or "come stai?", just talk. No tool calls needed.
- You don't introduce yourself as a bot or list your capabilities unless they ask. You're just Andrea, the guy on the other side of the chat.

Tool usage when needed: [TOOL_CALL:toolName:jsonObject]. Same tools as in the main prompt (factor_*, shell, list_skills, read_memory, etc.). Use them only when the conversation is clearly about vaults, yield, system, or something that requires data. Otherwise reply with a normal, friendly message.`;

const AGENT_ROLE_PROMPTS = {
    orchestrator: `You are the Orchestrator agent. You speak English. You run every 30 minutes to coordinate the other agents.

Memory: Use read_memory({ "date": "YYYY-MM-DD" }) to read today or yesterday (memory/). Use append_memory({ "content": "short note" }) to record significant outcomes so future runs have context. Text over brain — write it down.

Your jobs:
1. Discover which vaults to operate on: first call factor_get_owned_vaults (no params or ownerAddress) to list all vaults for the active wallet. From the result, choose which vault(s) to work on in this cycle (e.g. by TVL, last activity, or iterate over all). For each chosen vault use factor_get_vault_info, factor_get_shares, factor_get_executions to monitor its state.
2. Trigger the DeFi Expert (agent on port 3101): use call_agent with port 3101 and a message containing the vault address(es), chain, current assets and positions so they can propose a yield-maximizing strategy based on Factor strategies skills.
3. Trigger the Executor (agent on port 3102): use call_agent with port 3102 and the strategy or actions. The Executor must always execute real transactions (validate with simulate, then always broadcast). No human approval required.
4. Optionally trigger the System Improver (agent on port 3103): use call_agent with port 3103 to ask for system health checks and improvement suggestions.

Always use post_to_discord to report: when you start a cycle, when you get results from each agent, and a detailed summary at the end. Write as much info as you can: vault state, strategy proposed, execution steps, tx hashes, errors. Use append_memory to record full cycle outcomes for future runs.

On heartbeat (POST /heartbeat): you receive HEARTBEAT.md checklist. Follow it; if nothing needs attention reply exactly HEARTBEAT_OK.

Tool usage: [TOOL_CALL:toolName:jsonObject]. You have: factor_*, yield_opportunities, shell, list_skills, read_memory, append_memory, call_agent, post_to_discord.`,

    "defi-expert": `You are the DeFi Expert agent. You speak English. You are triggered by the Orchestrator.

Memory: Use read_memory and append_memory for today's date to keep context across runs. Write significant strategy decisions or errors.

Your role: You know DeFi protocols, their APIs, and Factor Protocol (Studio Pro vaults, strategies, adapters). Given a vault address, its chain, assets and current positions, you propose a new strategy that maximizes APY. Use the Factor strategies skill: canvas steps (LEND, BORROW, SWAP, REPAY, WITHDRAW_LENDING, etc.), factory whitelisted adapters and assets. You do NOT execute transactions or use the wallet; you only analyze and output a clear strategy (steps, parameters) for the Executor to run.

When the Orchestrator sends you a message, use factor_get_vault_info, factor_get_factory_addresses, yield_opportunities as needed. Reply with a concrete strategy description (steps, protocols, amounts, APY). Use post_to_discord with as much detail as you can: strategy steps, recommended amounts, protocols, expected APY. Use append_memory to record strategy decisions. On heartbeat (HEARTBEAT.md): if nothing to do, reply exactly HEARTBEAT_OK.

Tool usage: [TOOL_CALL:toolName:jsonObject]. You have: factor_get_vault_info, factor_get_factory_addresses, factor_list_adapters, factor_list_building_blocks, yield_opportunities, list_skills, read_memory, append_memory, post_to_discord. No factor_execute_*, no wallet.`,

    executor: `You are the Executor agent. You speak English. You are triggered by the Orchestrator.

Memory: Use append_memory to record execution outcomes (success/failure, tx hash if any). Use read_memory for recent context.

Your role: You compile transactions and use the wallet via Factor MCP. You receive a strategy (from the DeFi Expert or Orchestrator) and you MUST always execute real transactions. Use factor_simulate_strategy only to validate; then ALWAYS call factor_execute_strategy or factor_execute_manager to broadcast real transactions. Never only simulate and stop — always execute. No human approval required. Write as much info as you can: post_to_discord with detailed summaries (steps, amounts, tx hashes, outcomes), append_memory with full execution results and any errors. On heartbeat: reply HEARTBEAT_OK if nothing to do.

Tool usage: [TOOL_CALL:toolName:jsonObject]. You have: all factor_* tools, shell, read_memory, append_memory, post_to_discord.`,

    "system-improver": `You are the System Improver agent. You speak English. You are triggered by the Orchestrator (or run periodically).

Memory: Use read_memory and append_memory. Record findings, errors, and improvements so you don't repeat work.

Your role: You improve the overall system of the four agents. You have full access: sudo, systemctl, all files and logs on the Pi. You manage operations via the OpenClaw CLI when installed: use the shell tool to run openclaw health, openclaw status, openclaw gateway status, openclaw cron list, openclaw channels status, openclaw logs, openclaw doctor (see skill openclaw-cli.md). When the CLI is not installed, use curl for our agent APIs (e.g. curl http://127.0.0.1:3100/health) and systemctl for openclaw, openclaw-agent2, openclaw-agent3, openclaw-agent4. Read logs (journalctl -u openclaw, /data/logs/openclaw, syslog), check CPU/memory/disk (shell), suggest or apply improvements. Use post_to_discord to report findings with as much detail as you can: metrics, errors, recommendations. Use append_memory for significant findings. On heartbeat (HEARTBEAT.md): rotate through checks (load, disk, recent errors, optionally openclaw status); if nothing needs action reply HEARTBEAT_OK.

Tool usage: [TOOL_CALL:toolName:jsonObject]. You have: shell (sudo when needed), list_skills, add_skill, add_skill_from_path, add_skill_from_url, reload_skills, read_memory, append_memory, post_to_discord. Prefer safe, reversible changes.`
};

const ROLE_BASE = AGENT_ROLE && AGENT_ROLE_PROMPTS[AGENT_ROLE] ? AGENT_ROLE_PROMPTS[AGENT_ROLE] : BASE_PROMPT;

let SYSTEM_PROMPT = ROLE_BASE;
try {
    const skillText = await loadSkills();
    if (skillText) {
        SYSTEM_PROMPT = ROLE_BASE + "\n\n" + skillText;
        logger.info("[SKILLS] Loaded skills from " + SKILLS_DIR);
    }
} catch (e) {
    logger.warn("[SKILLS] Load failed: " + e.message);
}
if (AGENT_ROLE) logger.info("[AGENT] role=" + AGENT_ROLE + " label=" + AGENT_LABEL);

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

    async callOpenRouter(systemPrompt, messages, retries = 1, modelOverride = null) {
        if (!_openrouterKey) throw new Error("OpenRouter not configured. Set OPENROUTER_API_KEY or create " + path.join(OPENCLAW_ROOT, ".openrouter_key"));
        const openRouterMessages = [{ role: "system", content: systemPrompt }, ...messages];
        const model = modelOverride || CONFIG.openrouterModel;
        const body = {
            model,
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

    async callKimi(systemPrompt, messages, retries = 1) {
        // Kimi Code — Anthropic-compatible endpoint (https://api.kimi.com/coding/v1/messages)
        // Auth: x-api-key header + anthropic-version. Key from .kimi_key or KIMI_API_KEY.
        if (!_kimiKey) throw new Error("Kimi not configured. Get a Kimi Code API key at https://www.kimi.com/code/console and set KIMI_API_KEY or " + path.join(OPENCLAW_ROOT, ".kimi_key"));

        // Anthropic format: system is a top-level param, not a message role
        const kimiMessages = messages.map(m => ({ role: m.role === "system" ? "user" : m.role, content: m.content }));
        const body = {
            model: CONFIG.kimiModel,
            system: systemPrompt,
            messages: kimiMessages,
            max_tokens: 8192,
        };
        logger.info(`[AI] Kimi (Kimi Code agent): ${CONFIG.kimiUrl} model=${CONFIG.kimiModel}`);
        const doCall = async () => {
            if (AIEngine._apiLock) await AIEngine._apiLock;
            let _resolve;
            AIEngine._apiLock = new Promise(r => { _resolve = r; });
            try {
                const response = await axios.post(CONFIG.kimiUrl, body, {
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": _kimiKey.trim(),
                        "anthropic-version": "2023-06-01",
                    },
                });
                return response.data;
            } finally { _resolve(); AIEngine._apiLock = null; }
        };
        let data = await doCall();
        // Anthropic response: data.content is an array of {type, text}
        let text = "";
        let reasoning = "";
        if (Array.isArray(data.content)) {
            for (const block of data.content) {
                if (block.type === "thinking") reasoning += (block.text || block.thinking || "") + "\n";
                else if (block.type === "text") text += block.text || "";
            }
        }
        text = text.trim();
        reasoning = reasoning.trim();
        const usage = data.usage || {};
        if (!text && retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            data = await doCall();
            if (Array.isArray(data.content)) {
                for (const block of data.content) {
                    if (block.type === "thinking" && !reasoning) reasoning += (block.text || "") + "\n";
                    else if (block.type === "text") text += block.text || "";
                }
                text = text.trim();
                reasoning = reasoning.trim();
            }
        }
        if (!text) usage._error = data.error?.message || "empty response";
        return { text, reasoning: reasoning || null, usage };
    }

    async chat(message, chatId = "default", systemPrompt = SYSTEM_PROMPT, { maxRounds = 10 } = {}) {
        const provider = await getAiProvider();
        const needsMinimax = provider === "minimax";
        if (needsMinimax && !MiniMaxOAuth.getBearer()) throw new Error("Not authenticated. Use /auth/minimax");
        if (provider === "openrouter" && !_openrouterKey) throw new Error("OpenRouter not configured. Set OPENROUTER_API_KEY or add " + path.join(OPENCLAW_ROOT, ".openrouter_key"));
        if (provider === "kimi" && !_kimiKey) throw new Error("Kimi not configured. Get a Kimi Code API key at https://www.kimi.com/code/console and set " + path.join(OPENCLAW_ROOT, ".kimi_key"));
        this.addMessage(chatId, "user", message);
        const history = this.getHistory(chatId);
        logger.info(`[AI] Chat [${chatId}] (${provider}): "${message}" (${history.length} msgs)`);

        const callApi = (sys, msgs) => {
            if (provider === "openrouter") return this.callOpenRouter(sys, msgs);
            if (provider === "kimi") return this.callKimi(sys, msgs);
            return this.callMiniMax(sys, msgs);
        };
        const engineLabel = provider === "openrouter" ? "openrouter" : provider === "kimi" ? "kimi" : "minimax";
        const modelLabel = provider === "openrouter" ? CONFIG.openrouterModel : provider === "kimi" ? CONFIG.kimiModel : CONFIG.minimaxModel;

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

// ─── Discord Webhook (set via env; do not commit secrets) ────────────────────
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const DISCORD_THREAD_ID = process.env.DISCORD_THREAD_ID || "";

async function sendDiscordMessage(content, username = null) {
    if (!DISCORD_WEBHOOK_URL) return false;
    const name = username || AGENT_LABEL;
    try {
        const resp = await fetch(`${DISCORD_WEBHOOK_URL}?thread_id=${DISCORD_THREAD_ID}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: content.substring(0, 2000), username: name }),
        });
        if (!resp.ok) { logger.warn(`[DISCORD] ${resp.status}`); return false; }
        logger.info("[DISCORD] message sent as " + name);
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

// All agents: post to shared Discord (thread). Params: { message }.
tools.post_to_discord = async ({ message }) => {
    if (!message || typeof message !== "string") return { error: "message (string) required" };
    const ok = await sendDiscordMessage(`[${AGENT_LABEL}] ${message}`, AGENT_LABEL);
    return { success: ok };
};

// Memory (OpenClaw-style: daily notes, long-term). Path: OPENCLAW_ROOT/memory/
function todayStr() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
tools.read_memory = async ({ date }) => {
    const d = date || todayStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: "date must be YYYY-MM-DD" };
    try {
        const content = await fs.readFile(path.join(MEMORY_DIR, d + ".md"), "utf8");
        return { date: d, content };
    } catch (e) {
        if (e.code === "ENOENT") return { date: d, content: "" };
        return { error: e.message };
    }
};
tools.append_memory = async ({ content, date }) => {
    if (!content || typeof content !== "string") return { error: "content (string) required" };
    const d = date || todayStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: "date must be YYYY-MM-DD" };
    try {
        const f = path.join(MEMORY_DIR, d + ".md");
        const existing = await fs.readFile(f, "utf8").catch(() => "");
        const line = "[" + new Date().toISOString() + "] " + content.replace(/\n/g, " ") + "\n";
        await fs.writeFile(f, existing + line, "utf8");
        return { success: true, date: d };
    } catch (e) {
        return { error: e.message };
    }
};

// Orchestrator only: call another agent by port. Params: { port: 3101|3102|3103, message }.
if (AGENT_ROLE === "orchestrator") {
    tools.call_agent = async ({ port, message }) => {
        if (!port || !message) return { error: "port (3101|3102|3103) and message required" };
        const p = Number(port);
        if (![3101, 3102, 3103].includes(p)) return { error: "port must be 3101, 3102, or 3103" };
        try {
            const resp = await fetch(`http://127.0.0.1:${p}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message, chatId: `orchestrator-${Date.now()}` }),
            });
            const data = await resp.json();
            if (appendAgentJournal) await appendAgentJournal({ type: "tool_call", name: "call_agent", result: JSON.stringify({ port: p, response: data.response || data.error }) });
            return data.response ? { response: data.response, success: data.success } : { error: data.error || "No response" };
        } catch (e) {
            return { error: e.message };
        }
    };
}

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
    OPENCLAW_ROOT,
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

// Import a skill from a file path on the Pi (allowed: OPENCLAW_ROOT, /opt/openclaw, /data, /home/openclaw, /home/pi).
tools.add_skill_from_path = async ({ path: filePath, filename: asFilename }) => {
    if (!filePath || typeof filePath !== "string") return { error: "path (string) required" };
    const resolved = resolveSkillPathAllowed(filePath);
    if (!resolved) return { error: "Path not allowed (use a path under OPENCLAW_ROOT, /opt/openclaw, /data, /home/openclaw, /home/pi)" };
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

// Heartbeat — GET = health ping; POST = proactive turn (read HEARTBEAT.md, follow checklist, reply HEARTBEAT_OK if nothing)
const HEARTBEAT_PROMPT = "Read the checklist below. Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply exactly HEARTBEAT_OK.";
app.get("/heartbeat", (req, res) => {
    res.json({ status: "ok", agent: "0xpiclaw.eth", role: AGENT_ROLE || null, ts: new Date().toISOString() });
});
app.get("/HEARTBEAT", (req, res) => {
    res.json({ status: "ok", agent: "0xpiclaw.eth", role: AGENT_ROLE || null, ts: new Date().toISOString() });
});
app.post("/heartbeat", async (req, res) => {
    const customMessage = req.body?.message;
    let prompt = customMessage || HEARTBEAT_PROMPT;
    try {
        const heartbeatPath = path.join(OPENCLAW_ROOT, "HEARTBEAT.md");
        const checklist = await fs.readFile(heartbeatPath, "utf8").catch(() => "");
        if (checklist.trim()) {
            prompt = "HEARTBEAT.md checklist:\n---\n" + checklist.trim() + "\n---\n" + (customMessage || HEARTBEAT_PROMPT);
        }
        const result = await ai.chat(prompt, "heartbeat-" + Date.now(), SYSTEM_PROMPT, { maxRounds: 5 });
        const isOk = /HEARTBEAT_OK/i.test(result.response || "");
        res.json({ success: true, response: result.response, heartbeatOk: isOk });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Health
app.get("/health", async (req, res) => {
    const provider = await getAiProvider();
    const model = provider === "openrouter" ? CONFIG.openrouterModel : provider === "kimi" ? CONFIG.kimiModel : CONFIG.minimaxModel;
    res.json({
        status: "ok",
        agent: "0xpiclaw.eth",
        version: "2.0.0",
        uptime: process.uptime(),
        openclawRoot: OPENCLAW_ROOT,
        aiProvider: provider,
        model,
        auth: { oauth: MiniMaxOAuth.hasOAuth(), expired: MiniMaxOAuth.hasOAuth() ? MiniMaxOAuth.isExpired() : null, fallbackKey: !!_minimaxKey },
        openrouterConfigured: !!_openrouterKey,
        kimiConfigured: !!_kimiKey,
        factorMcp: factorBridge.ready,
    });
});

// AI provider switch (minimax | openrouter | kimi)
app.get("/api/ai-provider", async (req, res) => {
    try {
        const provider = await getAiProvider();
        res.json({
            provider,
            minimaxReady: !!MiniMaxOAuth.getBearer(),
            openrouterReady: !!_openrouterKey,
            openrouterModel: CONFIG.openrouterModel,
            kimiReady: !!_kimiKey,
            kimiModel: CONFIG.kimiModel,
            kimiVia: "kimi-code",
            kimiUrl: CONFIG.kimiUrl,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.post("/api/ai-provider", async (req, res) => {
    const { provider } = req.body;
    if (!provider) return res.status(400).json({ error: "provider required (minimax, openrouter, or kimi)" });
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

// Chat (MiniMax AI with tool loop). Used by: dashboard, Telegram bridge (telegram-bridge.js), Instagram webhook (/webhook/instagram).
// On Telegram (chatId starts with "telegram-") we use TELEGRAM_PROMPT so the agent is "Andrea0x" — friendly, like a friend.
app.post("/chat", async (req, res) => {
    const { message, chatId = "default" } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    const isTelegram = chatId && String(chatId).startsWith("telegram-");
    const telegramChatIdNum = isTelegram ? String(chatId).replace("telegram-", "") : "";
    const systemPrompt = isTelegram
        ? TELEGRAM_PROMPT + (telegramChatIdNum ? `\n\n[Current Telegram chat_id for this conversation: ${telegramChatIdNum}. If the user asks to receive cron/BTC price here, tell them to add TELEGRAM_CHAT_ID=${telegramChatIdNum} to /opt/openclaw/config/telegram.env and restart openclaw (sudo systemctl restart openclaw).]` : "")
        : SYSTEM_PROMPT;
    try {
        if (appendAgentJournal) await appendAgentJournal({ type: "chat", role: "user", content: message });
        const result = await ai.chat(message, chatId, systemPrompt);
        if (appendAgentJournal) await appendAgentJournal({ type: "chat", role: "assistant", content: result.response, reasoning: result.reasoning, tokens: result.tokens });
        if (result.response && AGENT_LABEL && !(chatId === "heartbeat" || chatId.startsWith("heartbeat-")) && !isTelegram) {
            const excerpt = result.response.length > 400 ? result.response.substring(0, 397) + "..." : result.response;
            sendDiscordMessage(`[${AGENT_LABEL}] ${excerpt}`, AGENT_LABEL).catch(() => {});
        }
        res.json(result);
    } catch (e) {
        if (appendAgentJournal) await appendAgentJournal({ type: "error", message: e.message });
        if (AGENT_LABEL) sendDiscordMessage(`[${AGENT_LABEL}] Error: ${e.message}`, AGENT_LABEL).catch(() => {});
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

// ─── Instagram Messaging webhook (Meta) ──────────────────────────────────────
// Requires: Instagram Professional account, Meta App with instagram_manage_messages.
// Env: INSTAGRAM_VERIFY_TOKEN (for GET verification), INSTAGRAM_ACCESS_TOKEN (for sending replies).
let _instagramVerifyToken = process.env.INSTAGRAM_VERIFY_TOKEN || "";
let _instagramAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN || "";
try { const t = (await fs.readFile(path.join(OPENCLAW_ROOT, ".instagram_verify_token"), "utf8")).trim(); if (t) _instagramVerifyToken = t; } catch {}
try { const t = (await fs.readFile(path.join(OPENCLAW_ROOT, ".instagram_access_token"), "utf8")).trim(); if (t) _instagramAccessToken = t; } catch {}

app.get("/webhook/instagram", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && _instagramVerifyToken && token === _instagramVerifyToken && challenge) {
        res.type("text/plain").send(challenge);
    } else {
        res.status(403).end();
    }
});

app.post("/webhook/instagram", async (req, res) => {
    res.status(200).end();
    if (!_instagramAccessToken) return;
    const body = req.body;
    if (body?.object !== "instagram" || !Array.isArray(body.entry)) return;
    for (const entry of body.entry) {
        if (!Array.isArray(entry.messaging)) continue;
        for (const ev of entry.messaging) {
            const msg = ev.message;
            if (!msg || msg.is_echo || msg.is_deleted) continue;
            const text = msg.text || (msg.quick_reply?.payload) || "";
            if (!text.trim()) continue;
            const senderId = ev.sender?.id;
            if (!senderId) continue;
            const chatId = `instagram-${senderId}`;
            try {
                if (appendAgentJournal) await appendAgentJournal({ type: "chat", role: "user", content: `[IG] ${text}`, channel: "instagram" });
                const result = await ai.chat(text.trim(), chatId);
                const reply = (result.response || "").slice(0, 2000);
                if (appendAgentJournal) await appendAgentJournal({ type: "chat", role: "assistant", content: reply, channel: "instagram" });
                const r = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(_instagramAccessToken)}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ recipient: { id: senderId }, message: { text: reply || "Ok." } }),
                });
                const data = await r.json();
                if (data.error) logger.warn("[Instagram] Send error:", data.error);
            } catch (e) {
                logger.error("[Instagram] " + e.message);
            }
        }
    }
});

// Cron: hourly yield optimizer (discover vaults via Factor MCP, then rebalance where applicable)
const CRON_SECRET = process.env.CRON_SECRET || "";
const YIELD_OPTIMIZER_PROMPT = `Run this task once:

1. Call factor_get_owned_vaults to list vaults for the active wallet. For each vault that is relevant (e.g. USDC denominator on Arbitrum), get factor_get_vault_info to know chain and adapters.

2. Call yield_opportunities with the vault's chain (e.g. "Arbitrum"), symbol "USDC", project matching the vault's adapters (e.g. "aave-v3,compound-v3"), limit 15. Compare APY for USDC on Aave V3 vs Compound V3 (or other whitelisted protocols).

3. For each vault you chose to optimize: if the APY difference between protocols justifies a rebalance, use factor_get_vault_info and factor_execute_manager (or factor_build_strategy / factor_simulate_strategy / factor_execute_strategy) as needed. Only execute rebalance if the APY difference justifies it and you have the right adapters. Reply with a short summary: vault(s), rates found, action taken (or skipped), and reason.`;

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

// Orchestrator: 30-min cycle (discover vaults via Factor MCP, then trigger DeFi expert, Executor, System improver).
const ORCHESTRATE_PROMPT = `Run your 30-minute cycle now. Write as much info as you can to Discord and memory.
1. Post to Discord: "Orchestrator: Starting 30min cycle." and append_memory with cycle start.
2. Call factor_get_owned_vaults to list vaults for the active wallet. Choose which vault(s) to operate on in this cycle (e.g. all, or the one with most TVL / recent activity). For each chosen vault: factor_get_vault_info, factor_get_shares. Post a detailed summary to Discord (vault address, chain, TVL, shares, assets, PPS, any positions). If there are no vaults, post that and skip strategy/execution for vaults.
3. Call the DeFi Expert (port 3101): send the vault address(es), chain, current state; ask for a yield-maximizing strategy. Post their full strategy summary to Discord (steps, protocols, amounts, APY).
4. Call the Executor (port 3102): send the strategy. The Executor must always execute real transactions (simulate to validate, then always broadcast). Post a detailed result to Discord (steps run, amounts, tx hashes, success/failure, errors if any). Append to memory the execution outcome.
5. Call the System Improver (port 3103): ask for system health (CPU, memory, disk, logs). Post their detailed findings to Discord.
6. Post to Discord: "Orchestrator: Cycle complete." with a detailed overall summary (vault(s) state, what was executed, any issues). Append to memory the cycle result.`;

app.post("/cron/orchestrate", async (req, res) => {
    if (AGENT_ROLE !== "orchestrator") return res.status(404).json({ error: "Not the orchestrator" });
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith("Bearer ") ? auth.slice(7) : (req.body?.secret || req.query?.secret);
    if (CRON_SECRET && token !== CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
    const chatId = "cron-orchestrate-" + Date.now();
    try {
        logger.info("[CRON] orchestrate started");
        const result = await ai.chat(ORCHESTRATE_PROMPT, chatId, SYSTEM_PROMPT, { maxRounds: 25 });
        logger.info("[CRON] orchestrate done");
        res.json({ success: true, response: result.response, tokens: result.tokens });
    } catch (e) {
        logger.error("[CRON] orchestrate error: " + e.message);
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
    logger.info(`AI provider: ${provider} | MiniMax: OAuth=${MiniMaxOAuth.hasOAuth()}, Key=${!!_minimaxKey} | OpenRouter: ${!!_openrouterKey} | Kimi: ${!!_kimiKey}`);
    if (_instagramVerifyToken && _instagramAccessToken) logger.info("Instagram webhook: enabled (POST /webhook/instagram)"); else if (_instagramVerifyToken || _instagramAccessToken) logger.warn("Instagram: set both INSTAGRAM_VERIFY_TOKEN and INSTAGRAM_ACCESS_TOKEN to enable");
    const ok = await factorBridge.start();
    logger.info(`Factor MCP: ${ok ? "connected" : "not available"}`);
    startCronJobs({
        port: CONFIG.port,
        secret: CRON_SECRET,
        agentRole: AGENT_ROLE,
        log: (msg) => logger.info(msg),
    });
});
