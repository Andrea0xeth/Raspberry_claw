#!/usr/bin/env python3
"""Apply OpenRouter switch to /opt/openclaw/src/index.js on Pi. Run on Pi."""
import pathlib

path = pathlib.Path("/opt/openclaw/src/index.js")
text = path.read_text()

# 1) Replace header and config block (first ~50 lines): remove OAuth, add OpenRouter
old_header = '''/**
 * Andrea0x.eth_Claw - DeFi Agent on Raspberry Pi 4
 * AI Engine: MiniMax (OAuth + Anthropic API) | DeFi: Factor Protocol (MCP)
 */

import express from "express";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { createLogger, format, transports } from "winston";
import cron from "node-cron";

const execAsync = promisify(exec);

// ─── Configuration ─────────────────────────────────────────────────────────
const OAUTH_TOKEN_FILE = "/opt/openclaw/.minimax_oauth.json";
const MINIMAX_CLIENT_ID = "78257093-7e40-4613-99e0-527b14b39113";
const MINIMAX_OAUTH_SCOPE = "group_id profile model.completion";
const MINIMAX_BASE_URL = "https://api.minimax.io";

// Load OAuth tokens if present
let _oauthTokens = null;
try {
    const raw = await fs.readFile(OAUTH_TOKEN_FILE, "utf8");
    _oauthTokens = JSON.parse(raw);
} catch {}

// Fallback API key (old method)
let _minimaxKey = process.env.MINIMAX_API_KEY || "";
try {
    const key = (await fs.readFile("/opt/openclaw/.minimax_key", "utf8")).trim();
    if (key) _minimaxKey = key;
} catch {}

const CONFIG = {
    port: parseInt(process.env.OPENCLAW_PORT || "3100"),
    minimaxModel: process.env.MINIMAX_MODEL || "MiniMax-M2.1",
    minimaxUrl: `${MINIMAX_BASE_URL}/anthropic/v1/messages`,
    factorMcpPath: process.env.FACTOR_MCP_PATH || "/opt/factor-mcp/dist/index.js",
    logDir: process.env.LOG_DIR || "/data/logs/openclaw",
    dataDir: process.env.DATA_DIR || "/data",
    decisionInterval: "*/5 * * * *",
};

// ─── MiniMax OAuth Module ────────────────────────────────────────────────────
const MiniMaxOAuth = {
    tokens: _oauthTokens,
    pendingAuth: null, // { verifier, userCode, verificationUri, expiresAt, polling }

    /** Get current Bearer token (OAuth preferred, fallback to API key) */
    getBearer() {
        if (this.tokens?.access) return this.tokens.access;
        return _minimaxKey || null;
    },

    /** Check if OAuth tokens are available */
    hasOAuth() { return !!(this.tokens?.access && this.tokens?.refresh); },

    /** Check if token is expired (with 5min buffer) */
    isExpired() {
        if (!this.tokens?.expires) return true;
        return Date.now() > (this.tokens.expires * 1000) - 300000;
    },

    /** Save tokens to disk */
    async saveTokens(tokens) {
        this.tokens = tokens;
        await fs.writeFile(OAUTH_TOKEN_FILE, JSON.stringify(tokens, null, 2), "utf8");
        await fs.chmod(OAUTH_TOKEN_FILE, 0o600);
    },

    /** Refresh the access token using refresh_token */
    async refreshToken() {
        if (!this.tokens?.refresh) throw new Error("No refresh token");
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            client_id: MINIMAX_CLIENT_ID,
            refresh_token: this.tokens.refresh,
        });
        const resp = await fetch(`${MINIMAX_BASE_URL}/oauth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body,
        });
        const data = await resp.json();
        if (data.access_token && data.refresh_token) {
            const newTokens = {
                access: data.access_token,
                refresh: data.refresh_token,
                expires: data.expired_in || (Math.floor(Date.now() / 1000) + 3600),
                resourceUrl: data.resource_url || this.tokens.resourceUrl,
            };
            await this.saveTokens(newTokens);
            return newTokens;
        }
        throw new Error(`Refresh failed: ${data.base_resp?.status_msg || JSON.stringify(data)}`);
    },

    /** Ensure we have a valid token (refresh if needed) */
    async ensureValidToken() {
        if (this.hasOAuth() && this.isExpired()) {
            try {
                await this.refreshToken();
            } catch (e) {
                // If refresh fails, tokens are stale
                this.tokens = null;
                throw new Error(`Token refresh failed: ${e.message}. Re-authenticate with /auth/minimax`);
            }
        }
        const bearer = this.getBearer();
        if (!bearer) throw new Error("Not authenticated. Use /auth/minimax to login via OAuth.");
        return bearer;
    },

    /** Start OAuth device code flow - returns user_code + verification_uri */
    async startAuth() {
        const verifier = crypto.randomBytes(32).toString("base64url");
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
        const state = crypto.randomBytes(16).toString("base64url");

        const body = new URLSearchParams({
            response_type: "code",
            client_id: MINIMAX_CLIENT_ID,
            scope: MINIMAX_OAUTH_SCOPE,
            code_challenge: challenge,
            code_challenge_method: "S256",
            state,
        });
        const resp = await fetch(`${MINIMAX_BASE_URL}/oauth/code`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
                "x-request-id": crypto.randomUUID(),
            },
            body,
        });
        if (!resp.ok) throw new Error(`OAuth code request failed: ${await resp.text()}`);
        const data = await resp.json();
        if (!data.user_code || !data.verification_uri) {
            throw new Error(data.error || "OAuth returned incomplete response");
        }
        if (data.state !== state) throw new Error("OAuth state mismatch");

        this.pendingAuth = {
            verifier,
            userCode: data.user_code,
            verificationUri: data.verification_uri,
            expiresAt: data.expired_in,
            polling: true,
        };

        // Start background polling
        this._pollForToken();

        return { user_code: data.user_code, verification_uri: data.verification_uri };
    },

    /** Background poll for token approval */
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
                    client_id: MINIMAX_CLIENT_ID,
                    user_code: userCode,
                    code_verifier: verifier,
                });
                const resp = await fetch(`${MINIMAX_BASE_URL}/oauth/token`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                    body,
                });
                const data = await resp.json();

                if (data.status === "success" && data.access_token) {
                    const tokens = {
                        access: data.access_token,
                        refresh: data.refresh_token,
                        expires: data.expired_in || (Math.floor(Date.now() / 1000) + 3600),
                        resourceUrl: data.resource_url,
                    };
                    await this.saveTokens(tokens);
                    this.pendingAuth = { ...this.pendingAuth, polling: false, completed: true };
                    return;
                }
                if (data.status === "error") {
                    this.pendingAuth = { ...this.pendingAuth, polling: false, error: data.base_resp?.status_msg || "Auth failed" };
                    return;
                }
                // Still pending - back off
                interval = Math.min(interval * 1.5, 10000);
            } catch (e) {
                // Network error, retry
                interval = Math.min(interval * 2, 15000);
            }
        }
        if (this.pendingAuth?.polling) {
            this.pendingAuth = { ...this.pendingAuth, polling: false, error: "Timed out" };
        }
    },
};
'''

new_header = '''/**
 * Andrea0x.eth_Claw - DeFi Agent on Raspberry Pi 4
 * AI Engine: OpenRouter (Kimi K2.5) | DeFi: Factor Protocol (MCP)
 */

import express from "express";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { createLogger, format, transports } from "winston";
import cron from "node-cron";

const execAsync = promisify(exec);

// ─── Configuration ─────────────────────────────────────────────────────────
const CONFIG = {
    port: parseInt(process.env.OPENCLAW_PORT || "3100"),
    model: process.env.OPENROUTER_MODEL || "moonshotai/kimi-k2.5",
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    openrouterKey: process.env.OPENROUTER_API_KEY || "",
    factorMcpPath: process.env.FACTOR_MCP_PATH || "/opt/factor-mcp/dist/index.js",
    logDir: process.env.LOG_DIR || "/data/logs/openclaw",
    dataDir: process.env.DATA_DIR || "/data",
    decisionInterval: "*/5 * * * *",
};

function getOpenRouterKey() {
    if (CONFIG.openrouterKey) return CONFIG.openrouterKey;
    return null;
}
'''

if old_header not in text:
    raise SystemExit("Old header block not found (maybe already patched?)")
text = text.replace(old_header, new_header, 1)

# 2) SYSTEM_PROMPT: remove minimax_auth from tools list
text = text.replace(
    "read_file, write_file, web_search, web_fetch, system_info, minimax_auth",
    "read_file, write_file, web_search, web_fetch, system_info",
    1
)

# 3) Replace AI Engine comment and callMiniMax with callOpenRouter
old_call = '''// ─── AI Engine (MiniMax) ────────────────────────────────────────────────────
class AIEngine {
    constructor() {
        this.conversations = new Map();
    }

    getHistory(chatId) {
        if (!this.conversations.has(chatId)) {
            this.conversations.set(chatId, []);
        }
        const msgs = this.conversations.get(chatId);
        if (msgs.length > 20) {
            this.conversations.set(chatId, msgs.slice(-20));
        }
        return this.conversations.get(chatId);
    }

    addMessage(chatId, role, content) {
        this.getHistory(chatId).push({ role, content });
    }

    clearHistory(chatId) {
        this.conversations.delete(chatId);
    }

    /**
     * Call MiniMax via Anthropic Messages API (OAuth token preferred)
     * @param {string} systemPrompt - System prompt (separate field in Anthropic API)
     * @param {Array} messages - User/assistant messages (no system role!)
     */
    async callMiniMax(systemPrompt, messages, retries = 1) {
        const bearer = await MiniMaxOAuth.ensureValidToken();

        // Anthropic Messages API format
        const body = {
            model: CONFIG.minimaxModel,
            max_tokens: 8192,
            system: systemPrompt,
            messages,
            temperature: 0.7,
        };

        // Serialize MiniMax API calls to avoid concurrent rate-limit issues
        const doCall = async () => {
            if (AIEngine._apiLock) await AIEngine._apiLock;
            let _resolve;
            AIEngine._apiLock = new Promise(r => { _resolve = r; });
            try {
                const response = await axios.post(CONFIG.minimaxUrl, body, {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${bearer}`,
                        "anthropic-version": "2023-06-01",
                    },
                    timeout: 30000,
                });
                return response.data;
            } finally {
                _resolve();
                AIEngine._apiLock = null;
            }
        };

        let data = await doCall();
        let text = data.content?.map(c => c.text || "").join("") || "";

        // Retry on empty response with exponential backoff
        if (!text && retries > 0) {
            for (let retry = 0; retry < retries; retry++) {
                const delay = 3000 * (retry + 1); // 3s, 6s
                logger.warn(`[AI] Empty response, retrying in ${delay / 1000}s (attempt ${retry + 2})...`);
                await new Promise(r => setTimeout(r, delay));
                try {
                    data = await doCall();
                    text = data.content?.map(c => c.text || "").join("") || "";
                    if (text) break;
                } catch (e) {
                    logger.warn(`[AI] Retry ${retry + 2} failed: ${e.message}`);
                }
            }
        }

        if (!text) {
            const errType = data.type || "unknown";
            const errMsg = data.error?.message || "empty response";
            logger.warn(`[AI] Empty response after retries: type=${errType}, error=${errMsg}`);
        }

        const usage = data.usage || {};
        if (!text) {
            usage._error = data.error?.message || "empty response";
        }
        return { text, usage };
    }
'''

new_call = '''// ─── AI Engine (OpenRouter) ───────────────────────────────────────────────────
class AIEngine {
    constructor() {
        this.conversations = new Map();
    }

    getHistory(chatId) {
        if (!this.conversations.has(chatId)) {
            this.conversations.set(chatId, []);
        }
        const msgs = this.conversations.get(chatId);
        if (msgs.length > 20) {
            this.conversations.set(chatId, msgs.slice(-20));
        }
        return this.conversations.get(chatId);
    }

    addMessage(chatId, role, content) {
        this.getHistory(chatId).push({ role, content });
    }

    clearHistory(chatId) {
        this.conversations.delete(chatId);
    }

    /**
     * Call OpenRouter (OpenAI chat completions format)
     * @param {string} systemPrompt - System prompt
     * @param {Array} messages - User/assistant messages (no system role in array)
     */
    async callOpenRouter(systemPrompt, messages, retries = 1) {
        const bearer = getOpenRouterKey();
        if (!bearer) throw new Error("OPENROUTER_API_KEY not set. Set it in the environment or systemd.");

        // OpenAI chat completions: system as first message
        const allMessages = [{ role: "system", content: systemPrompt }, ...messages];
        const body = {
            model: CONFIG.model,
            max_tokens: 8192,
            messages: allMessages,
            temperature: 0.7,
        };

        const doCall = async () => {
            if (AIEngine._apiLock) await AIEngine._apiLock;
            let _resolve;
            AIEngine._apiLock = new Promise(r => { _resolve = r; });
            try {
                const response = await axios.post(CONFIG.apiUrl, body, {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${bearer}`,
                        "HTTP-Referer": "https://piclaw.supasoft.xyz",
                    },
                    timeout: 60000,
                });
                return response.data;
            } finally {
                _resolve();
                AIEngine._apiLock = null;
            }
        };

        let data = await doCall();
        let text = data.choices?.[0]?.message?.content ?? "";
        const usage = data.usage || { input_tokens: 0, output_tokens: 0 };

        if (!text && retries > 0) {
            for (let retry = 0; retry < retries; retry++) {
                const delay = 3000 * (retry + 1);
                logger.warn(`[AI] Empty response, retrying in ${delay / 1000}s (attempt ${retry + 2})...`);
                await new Promise(r => setTimeout(r, delay));
                try {
                    data = await doCall();
                    text = data.choices?.[0]?.message?.content ?? "";
                    if (text) break;
                } catch (e) {
                    logger.warn(`[AI] Retry ${retry + 2} failed: ${e.message}`);
                }
            }
        }

        if (!text) {
            const errMsg = data.error?.message || data.choices?.[0]?.message?.content || "empty response";
            logger.warn(`[AI] Empty response after retries: ${errMsg}`);
            usage._error = errMsg;
        }
        return { text, usage };
    }
'''

if old_call not in text:
    raise SystemExit("Old callMiniMax block not found")
text = text.replace(old_call, new_call, 1)

# 4) Replace callMiniMax with callOpenRouter in _chatInner
text = text.replace("let result = await this.callMiniMax(systemPrompt, messages);", "let result = await this.callOpenRouter(systemPrompt, messages);", 1)

# 5) chat() auth check: replace MiniMaxOAuth.getBearer() with getOpenRouterKey()
text = text.replace(
    'if (!MiniMaxOAuth.getBearer()) {\n            throw new Error("Not authenticated. Use /auth/minimax to login via MiniMax OAuth.");\n        }',
    'if (!getOpenRouterKey()) {\n            throw new Error("OPENROUTER_API_KEY not set. Configure it in the systemd service or environment.");\n        }',
    1
)

# 6) Health endpoint
old_health = '''app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        agent: "Andrea0x.eth_Claw",
        uptime: process.uptime(),
        engine: "multi-agent",
        model: CONFIG.minimaxModel,
        agents: ["supervisor", "defi", "research", "system"],
        auth: {
            oauth: MiniMaxOAuth.hasOAuth(),
            expired: MiniMaxOAuth.hasOAuth() ? MiniMaxOAuth.isExpired() : null,
            fallbackKey: !!_minimaxKey,
        },
        factorMcp: factorBridge.ready,
    });
});'''
new_health = '''app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        agent: "Andrea0x.eth_Claw",
        uptime: process.uptime(),
        engine: "multi-agent",
        model: CONFIG.model,
        agents: ["supervisor", "defi", "research", "system"],
        auth: { openrouter: !!getOpenRouterKey() },
        factorMcp: factorBridge.ready,
    });
});'''
text = text.replace(old_health, new_health, 1)

# 7) Remove MiniMax OAuth auth endpoints and replace with simple stub
old_auth_block = '''// ─── MiniMax OAuth Auth Endpoints ────────────────────────────────────────────

/** Start OAuth device code flow */
app.post("/auth/minimax", async (req, res) => {
    try {
        const result = await MiniMaxOAuth.startAuth();
        logger.info(`[AUTH] OAuth started - code: ${result.user_code}, uri: ${result.verification_uri}`);
        res.json({
            success: true,
            message: `Open the URL below and enter the code to authenticate:`,
            user_code: result.user_code,
            verification_uri: result.verification_uri,
            instructions: `1. Open: ${result.verification_uri}\n2. Enter code: ${result.user_code}\n3. Approve access`,
        });
    } catch (error) {
        logger.error(`[AUTH] OAuth start failed: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/** Check OAuth status */
app.get("/auth/minimax/status", (req, res) => {
    if (MiniMaxOAuth.hasOAuth()) {
        return res.json({
            authenticated: true,
            expired: MiniMaxOAuth.isExpired(),
            expires: MiniMaxOAuth.tokens?.expires,
        });
    }
    if (MiniMaxOAuth.pendingAuth) {
        return res.json({
            authenticated: false,
            pending: MiniMaxOAuth.pendingAuth.polling,
            completed: MiniMaxOAuth.pendingAuth.completed || false,
            error: MiniMaxOAuth.pendingAuth.error || null,
        });
    }
    res.json({ authenticated: false, pending: false, fallbackKey: !!_minimaxKey });
});

/** Force token refresh */
app.post("/auth/minimax/refresh", async (req, res) => {
    try {
        const tokens = await MiniMaxOAuth.refreshToken();
        res.json({ success: true, expires: tokens.expires });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/chat",'''
new_auth_block = '''// ─── Auth (OpenRouter uses API key only; /auth/minimax kept for backwards compat, no-op) ───
app.post("/auth/minimax", (req, res) => res.json({ success: false, message: "OAuth disabled; using OpenRouter API key." }));
app.get("/auth/minimax/status", (req, res) => res.json({ authenticated: !!getOpenRouterKey(), engine: "openrouter" }));
app.post("/auth/minimax/refresh", (req, res) => res.json({ success: false, message: "N/A for OpenRouter." }));

app.post("/chat",'''
text = text.replace(old_auth_block, new_auth_block, 1)

# 8) /ai/config
old_ai_config = '''app.get("/ai/config", (req, res) => {
    res.json({
        engine: "minimax-oauth",
        model: CONFIG.minimaxModel,
        auth: {
            oauth: MiniMaxOAuth.hasOAuth(),
            expired: MiniMaxOAuth.hasOAuth() ? MiniMaxOAuth.isExpired() : null,
            fallbackKey: !!_minimaxKey,
        },
        factorMcp: factorBridge.ready,
    });
});'''
new_ai_config = '''app.get("/ai/config", (req, res) => {
    res.json({
        engine: "openrouter",
        model: CONFIG.model,
        auth: { configured: !!getOpenRouterKey() },
        factorMcp: factorBridge.ready,
    });
});'''
text = text.replace(old_ai_config, new_ai_config, 1)

# 9) Startup log message
text = text.replace(
    'logger.info(`AI: MiniMax ${CONFIG.minimaxModel} (OAuth: ${MiniMaxOAuth.hasOAuth() ? "yes" : "no"}, Key fallback: ${_minimaxKey ? "yes" : "no"})`);',
    'logger.info(`AI: OpenRouter ${CONFIG.model} (API key: ${getOpenRouterKey() ? "yes" : "no"})`);',
    1
)

# 10) Remove minimax_auth tool definition
old_minimax_tool = """    minimax_auth: async () => {
        logger.info("[TOOL:minimax_auth] Starting OAuth flow");
        try {
            if (MiniMaxOAuth.hasOAuth() && !MiniMaxOAuth.isExpired()) {
                return { success: true, message: "Already authenticated via OAuth", expires: MiniMaxOAuth.tokens.expires };
            }
            const result = await MiniMaxOAuth.startAuth();
            return {
                success: true,
                message: `Open this URL and enter the code to authenticate:\\n\\nURL: ${result.verification_uri}\\nCode: ${result.user_code}\\n\\nWaiting for approval...`,
                user_code: result.user_code,
                verification_uri: result.verification_uri,
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    agent_start:"""
new_minimax_tool = """    agent_start:"""
if old_minimax_tool in text:
    text = text.replace(old_minimax_tool, new_minimax_tool, 1)
else:
    # Try without escaped newlines in template
    old2 = """    minimax_auth: async () => {
        logger.info("[TOOL:minimax_auth] Starting OAuth flow");
        try {
            if (MiniMaxOAuth.hasOAuth() && !MiniMaxOAuth.isExpired()) {
                return { success: true, message: "Already authenticated via OAuth", expires: MiniMaxOAuth.tokens.expires };
            }
            const result = await MiniMaxOAuth.startAuth();
            return {
                success: true,
                message: `Open this URL and enter the code to authenticate:
URL: ${result.verification_uri}
Code: ${result.user_code}
Waiting for approval...`,
                user_code: result.user_code,
                verification_uri: result.verification_uri,
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    agent_start:"""
    text = text.replace(old2, new_minimax_tool, 1)

path.write_text(text)
print("Applied OpenRouter switch successfully.")
