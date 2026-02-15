/**
 * Andrea0x.eth_Claw - DeFi Agent on Raspberry Pi 4 (Single Agent)
 * AI Engine: MiniMax (OAuth + Anthropic API) | DeFi: Factor Protocol (MCP)
 * Architecture: ONE unified agent with ALL tools — no supervisor/worker split.
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
import { fileURLToPath } from "url";

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
    factorMcpPath: process.env.FACTOR_MCP_PATH || "/opt/openclaw/factor-mcp/dist/index.js",
    logDir: process.env.LOG_DIR || "/data/logs/openclaw",
    dataDir: process.env.DATA_DIR || "/data",
    decisionInterval: "*/5 * * * *",
};

// ─── MiniMax OAuth Module ────────────────────────────────────────────────────
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

    async ensureValidToken() {
        if (this.hasOAuth() && this.isExpired()) {
            try {
                await this.refreshToken();
            } catch (e) {
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
                interval = Math.min(interval * 1.5, 10000);
            } catch (e) {
                interval = Math.min(interval * 2, 15000);
            }
        }
        if (this.pendingAuth?.polling) {
            this.pendingAuth = { ...this.pendingAuth, polling: false, error: "Timed out" };
        }
    },
};

// ─── Unified Agent Prompt ────────────────────────────────────────────────────
const AGENT_PROMPT = `You are Andrea0x.eth_Claw, a self-evolving DeFi agent running on a Raspberry Pi 4. You manage Factor Protocol vaults across Arbitrum, Base, and Ethereum. You are ONE unified agent — no workers, no delegation. You do everything yourself.

YOUR WALLET: 0x8Ac130E606545aD94E26fCF09CcDd950A981A704
SUPPORTED CHAINS: Arbitrum One (ARBITRUM_ONE), Base (BASE), Ethereum Mainnet (MAINNET). ONLY these 3.

=== THINKING PROCESS ===
1. THINK: What do I need to find out?
2. ACT: Call a tool to get data
3. OBSERVE: Read the result carefully
4. REASON: What does this mean? Do I need more data?
5. REPEAT: If incomplete, call another tool. Keep going until I have a COMPLETE answer.
6. RESPOND: Give a thorough, well-reasoned final answer.

NEVER give a shallow answer. Always dig deeper. Chain multiple tools together.

=== FACTOR ADAPTERS PER CHAIN ===
ARBITRUM ONE:
  Lending: AaveAdapter (lend/borrow), SiloV2AdapterPro (isolated markets), CompoundV3AdapterPro (lend/borrow)
  Yield: PendleAdapter + PendlePYAdapter (PT/YT yield trading, LP, stake, harvest)
  Swap: OpenOceanAdapter (DEX aggregator), UniswapAdapter
  LP: UniswapV3LPAdapter, CamelotV3LPAdapter
  Flash Loans: BalancerFlashloan (key for leveraged yield strategies)

BASE:
  Lending: AaveAdapter, CompoundV3AdapterPro, MorphoAdapter (optimized lending)
  Yield: PendleAdapter + PendlePYAdapter
  Swap: OpenOceanAdapter, UniswapAdapter
  LP: UniswapV3LPAdapter, AerodromeLPAdapter (Base-native, often high APY)
  Flash Loans: BalancerFlashloan, MorphoFlashloan
  Other: AquaAdapter

=== LEVERAGE STRATEGY PATTERN ===
Use BalancerFlashloan for leveraged lending:
1. Flash loan X ETH via Balancer
2. LEND X ETH on Aave/Silo/Compound (earn supply APY)
3. BORROW Y USDC against collateral
4. SWAP Y USDC -> Z ETH via OpenOcean
5. Repay flash loan + fee
Net result: leveraged yield = supply_apy * leverage_multiplier - borrow_cost

=== HOW TO CALL TOOLS === (format: [TOOL_CALL:name:{"param":"value"}])

— DEFI —
[TOOL_CALL:eth_balance:{}]
[TOOL_CALL:factor_get_config:{}]
[TOOL_CALL:factor_set_chain:{"chain":"ARBITRUM_ONE"}]
[TOOL_CALL:factor_get_owned_vaults:{}]
[TOOL_CALL:factor_get_vault_info:{"vaultAddress":"0x..."}]
[TOOL_CALL:factor_get_shares:{"vaultAddress":"0x..."}]
[TOOL_CALL:factor_build_strategy:{"vaultAddress":"0x...","steps":[{"adapter":"aave-v3","action":"LEND","params":{"asset":"0x...","amount":"1000000"}}]}]
[TOOL_CALL:factor_simulate_strategy:{"strategyId":"..."}]
[TOOL_CALL:factor_get_factory_addresses:{}]
All factor tools: factor_get_config, factor_set_chain, factor_set_rpc, factor_get_owned_vaults, factor_get_vault_info, factor_get_shares, factor_deposit, factor_withdraw, factor_create_vault, factor_list_adapters, factor_list_building_blocks, factor_build_strategy, factor_simulate_strategy, factor_execute_strategy, factor_execute_manager, factor_cast_call, factor_get_factory_addresses, factor_add_adapter, factor_get_executions, factor_preview_deposit, factor_preview_withdraw, factor_preview_transaction, factor_get_transaction_status, factor_check_foundry, factor_validate_vault_config, factor_simulate_transaction, factor_decode_error

— RESEARCH —
[TOOL_CALL:web_search:{"query":"ETH price today"}]
[TOOL_CALL:web_fetch:{"url":"https://example.com"}]

— SYSTEM —
[TOOL_CALL:shell:{"command":"uptime"}]
[TOOL_CALL:read_file:{"path":"/opt/openclaw/src/index.js"}]
[TOOL_CALL:write_file:{"path":"/tmp/test.txt","content":"hello"}]
[TOOL_CALL:system_info:{}]

— SELF-CONTROL —
[TOOL_CALL:agent_start:{}]
[TOOL_CALL:agent_stop:{}]
[TOOL_CALL:agent_status:{}]
[TOOL_CALL:agent_journal:{"count":10}]

=== YIELD SCANNER ===
You have a pre-built yield scanner at /opt/openclaw/scripts/yield-scanner.js
[TOOL_CALL:shell:{"command":"node /opt/openclaw/scripts/yield-scanner.js --limit 20"}]
Options: --chain Arbitrum|Base, --limit N, --min-tvl N, --min-apy N

=== YOUR BODY (file system) ===
/opt/openclaw/src/index.js — YOUR BRAIN (main app, you CAN edit this)
/opt/openclaw/scripts/      — utility scripts (yield-scanner.js, etc.)
/opt/openclaw/factor-mcp/   — Factor Protocol MCP server
/data/agent-journal/        — YOUR MEMORY (jsonl + yield-reports.md, error-memory.jsonl, notes.md)
/data/logs/openclaw/        — your logs

=== CODING ===
You can write production-quality code (Node.js ESM, Python, Bash). Raspberry Pi 4 arm64, Node.js 20.
- Read before writing. Always read the target file first.
- Test your code: run it with shell after writing.
- Standalone scripts go in /opt/openclaw/scripts/ — one script per capability.
- After editing index.js: [TOOL_CALL:shell:{"command":"sudo systemctl restart openclaw"}]

=== HARD RULES ===
- NEVER call factor_wallet_setup (do NOT create wallets). You already have one.
- NEVER repeat errors from the ERROR MEMORY.
- Always use correct chain enum: ARBITRUM_ONE, BASE, MAINNET.
- Use eth_balance for ETH. Use factor tools for blockchain (never shell/curl).
- Confirm before moving funds.
- Always simulate strategies before executing (factor_simulate_strategy before factor_execute_strategy).`;

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

// ─── Tool Call Parser (handles nested JSON brackets) ─────────────────────────
function extractToolCall(text) {
    const marker = "[TOOL_CALL:";
    const idx = text.indexOf(marker);
    if (idx === -1) return null;

    const afterMarker = idx + marker.length;
    const colonIdx = text.indexOf(":", afterMarker);
    if (colonIdx === -1) return null;

    const toolName = text.substring(afterMarker, colonIdx);
    const jsonStart = colonIdx + 1;

    let depth = 0;
    let inString = false;
    let escaped = false;

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
                const fullMatch = text.substring(idx, endIdx);
                return { toolName, params, fullMatch };
            }
        }
    }
    return null;
}

// ─── AI Engine (MiniMax) — No timeouts ──────────────────────────────────────
class AIEngine {
    constructor() {
        this.conversations = new Map();
    }

    getHistory(chatId) {
        if (!this.conversations.has(chatId)) {
            this.conversations.set(chatId, []);
        }
        const msgs = this.conversations.get(chatId);
        if (msgs.length > 10) {
            this.conversations.set(chatId, msgs.slice(-10));
        }
        return this.conversations.get(chatId);
    }

    addMessage(chatId, role, content) {
        this.getHistory(chatId).push({ role, content });
    }

    clearHistory(chatId) {
        this.conversations.delete(chatId);
    }

    /** Call MiniMax via Anthropic Messages API — no timeout */
    async callMiniMax(systemPrompt, messages, retries = 1) {
        const bearer = await MiniMaxOAuth.ensureValidToken();

        const body = {
            model: CONFIG.minimaxModel,
            max_tokens: 8192,
            system: systemPrompt,
            messages,
            temperature: 0.7,
        };

        // Serialize API calls to avoid concurrent rate-limit issues
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
                    // No timeout — let the agent work as long as needed
                });
                return response.data;
            } finally {
                _resolve();
                AIEngine._apiLock = null;
            }
        };

        let data = await doCall();
        let text = data.content?.map(c => c.text || "").join("") || "";

        // Retry once on empty response
        if (!text && retries > 0) {
            logger.warn(`[AI] Empty response, retrying in 2s...`);
            await new Promise(r => setTimeout(r, 2000));
            data = await doCall();
            text = data.content?.map(c => c.text || "").join("") || "";
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

    /** Chat with tool loop — no timeout, no worker isolation */
    async chat(message, chatId = "default", systemPrompt = AGENT_PROMPT, { maxRounds = 10 } = {}) {
        if (!MiniMaxOAuth.getBearer()) {
            throw new Error("Not authenticated. Use /auth/minimax to login via MiniMax OAuth.");
        }

        this.addMessage(chatId, "user", message);
        const history = this.getHistory(chatId);

        logger.info(`[AI] Chat [${chatId}]: "${message.substring(0, 80)}..." (${history.length} msgs, maxRounds=${maxRounds})`);

        try {
            const messages = history.map(m => ({ role: m.role, content: m.content }));

            let result = await this.callMiniMax(systemPrompt, messages);
            let totalTokens = (result.usage.input_tokens || 0) + (result.usage.output_tokens || 0);

            // Tool call loop
            for (let round = 0; round < maxRounds; round++) {
                const toolCall = extractToolCall(result.text);
                if (!toolCall) break;

                const toolName = toolCall.toolName;
                const toolParamsStr = toolCall.params;

                logger.info(`[AI] Tool call detected: ${toolName}(${toolParamsStr.substring(0, 100)})`);

                let toolResult;
                try {
                    // Hard-block wallet creation
                    if (toolName === "factor_wallet_setup") {
                        toolResult = { success: false, error: "BLOCKED: wallet creation is disabled. Use existing wallet 0x8Ac130E606545aD94E26fCF09CcDd950A981A704" };
                    // Hard-block dangerous tools during autonomous cycles
                    } else if (autonomousCycleActive && AUTONOMOUS_BLOCKED_TOOLS.has(toolName)) {
                        toolResult = { success: false, error: `BLOCKED: ${toolName} is not allowed during autonomous cycles. Only build + simulate strategies. User must approve execution via Discord/Telegram.` };
                        logger.warn(`[SAFETY] Blocked ${toolName} during autonomous cycle`);
                    } else {
                        const toolParams = JSON.parse(toolParamsStr);
                        if (tools[toolName]) {
                            toolResult = await tools[toolName](toolParams);
                        } else if (toolName.startsWith("factor_") && tools.factor) {
                            logger.info(`[AI] Auto-routing ${toolName} through factor bridge`);
                            toolResult = await tools.factor({ tool: toolName, params: toolParams });
                        } else {
                            toolResult = { success: false, error: `Tool '${toolName}' not found` };
                        }
                    }
                } catch (e) {
                    toolResult = { success: false, error: e.message };
                }

                // Save errors to error memory
                if (toolResult?.success === false || toolResult?._isError) {
                    saveError(toolName, toolResult.error || toolResult.result || "unknown error", toolParamsStr.substring(0, 200)).catch(() => {});
                }

                // Add assistant's tool call + tool result to conversation
                this.addMessage(chatId, "assistant", result.text);
                const toolResultStr = JSON.stringify(toolResult, null, 2);
                const maxLen = chatId.startsWith("agent-") ? 800 : 2000;
                const truncatedResult = toolResultStr.length > maxLen
                    ? toolResultStr.substring(0, maxLen) + "\n... (truncated)"
                    : toolResultStr;
                this.addMessage(chatId, "user", `[TOOL_RESULT:${toolName}]\n${truncatedResult}`);

                const updatedMessages = this.getHistory(chatId).map(m => ({ role: m.role, content: m.content }));
                try {
                    result = await this.callMiniMax(systemPrompt, updatedMessages);
                    totalTokens += (result.usage.input_tokens || 0) + (result.usage.output_tokens || 0);
                } catch (e) {
                    logger.warn(`[AI] Error after tool call round ${round + 1}: ${e.message}`);
                    result = { text: `Tool ${toolName} executed. Result: ${truncatedResult.substring(0, 300)}`, usage: {} };
                    break;
                }
            }

            // Clean remaining tool call markers
            let cleanText = result.text || "";
            while (true) {
                const leftover = extractToolCall(cleanText);
                if (!leftover) break;
                cleanText = cleanText.replace(leftover.fullMatch, "");
            }
            cleanText = cleanText.trim();

            if (!cleanText) {
                const errMsg = result.usage?._error || "empty response";
                logger.warn(`[AI] Empty response: ${errMsg}`);
                return {
                    success: true,
                    response: `MiniMax returned empty (${errMsg}). Try again shortly.`,
                    engine: "single-agent",
                    model: CONFIG.minimaxModel,
                    tokens: { total_tokens: totalTokens },
                };
            }

            this.addMessage(chatId, "assistant", cleanText);
            logger.info(`[AI] Final: ${cleanText.substring(0, 80)}... (tokens: ${totalTokens})`);

            return {
                success: true,
                response: cleanText,
                engine: "single-agent",
                model: CONFIG.minimaxModel,
                tokens: { total_tokens: totalTokens },
            };
        } catch (error) {
            history.pop();
            logger.error(`[AI] Error: ${error.message}`);
            if (error.response) {
                logger.error(`[AI] Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }
}
AIEngine._apiLock = null;

// Single persistent agent
const ai = new AIEngine();

// ─── Tools Registry ─────────────────────────────────────────────────────────
const tools = {
    shell: async ({ command, timeout = 30000 }) => {
        logger.info(`[TOOL:shell] ${command}`);
        try {
            const { stdout, stderr } = await execAsync(command, {
                timeout,
                env: { ...process.env, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
            });
            return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
        } catch (error) {
            return { success: false, error: error.message, stderr: error.stderr?.trim() };
        }
    },

    read_file: async ({ path: filePath }) => {
        logger.info(`[TOOL:read_file] ${filePath}`);
        try {
            const content = await fs.readFile(filePath, "utf-8");
            return { success: true, content, size: content.length };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    write_file: async ({ path: filePath, content, mode = "0644" }) => {
        logger.info(`[TOOL:write_file] ${filePath}`);
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content, "utf-8");
            await fs.chmod(filePath, parseInt(mode, 8));
            return { success: true, path: filePath, size: content.length };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    gpio: async ({ pin, action, value = null }) => {
        logger.info(`[TOOL:gpio] Pin ${pin}: ${action}`);
        try {
            let result;
            switch (action) {
                case "export":
                    await execAsync(`echo ${pin} | sudo tee /sys/class/gpio/export 2>/dev/null || true`);
                    result = { exported: true }; break;
                case "direction":
                    await execAsync(`echo ${value} | sudo tee /sys/class/gpio/gpio${pin}/direction`);
                    result = { direction: value }; break;
                case "read": {
                    const { stdout } = await execAsync(`cat /sys/class/gpio/gpio${pin}/value`);
                    result = { value: parseInt(stdout.trim()) }; break;
                }
                case "write":
                    await execAsync(`echo ${value} | sudo tee /sys/class/gpio/gpio${pin}/value`);
                    result = { written: value }; break;
                case "unexport":
                    await execAsync(`echo ${pin} | sudo tee /sys/class/gpio/unexport 2>/dev/null || true`);
                    result = { unexported: true }; break;
                default:
                    return { success: false, error: `Unknown GPIO action: ${action}` };
            }
            return { success: true, pin, action, ...result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    system_info: async () => {
        logger.info("[TOOL:system_info]");
        try {
            const [cpu, mem, disk, temp, uptime, load] = await Promise.all([
                execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'").then(r => r.stdout.trim()),
                execAsync("free -m | awk 'NR==2{printf \"%s/%sMB (%.1f%%)\", $3, $2, $3*100/$2}'").then(r => r.stdout.trim()),
                execAsync("df -h / /data 2>/dev/null | tail -n +2").then(r => r.stdout.trim()),
                execAsync("vcgencmd measure_temp 2>/dev/null || echo 'temp=N/A'").then(r => r.stdout.trim().replace("temp=", "")),
                execAsync("uptime -p").then(r => r.stdout.trim()),
                execAsync("cat /proc/loadavg").then(r => r.stdout.trim()),
            ]);
            return { success: true, cpu_usage: cpu, memory: mem, disk, temperature: temp, uptime, load_average: load, timestamp: new Date().toISOString() };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    service: async ({ name, action }) => {
        logger.info(`[TOOL:service] ${action} ${name}`);
        const valid = ["start", "stop", "restart", "status", "enable", "disable"];
        if (!valid.includes(action)) return { success: false, error: `Invalid: ${action}` };
        try {
            const { stdout } = await execAsync(`sudo systemctl ${action} ${name} 2>&1`);
            return { success: true, service: name, action, output: stdout.trim() };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    network: async ({ action, params = {} }) => {
        logger.info(`[TOOL:network] ${action}`);
        try {
            let result;
            switch (action) {
                case "interfaces":
                    result = await execAsync("ip -j addr show");
                    return { success: true, interfaces: JSON.parse(result.stdout) };
                case "connectivity":
                    result = await execAsync("ping -c 3 -W 5 8.8.8.8 2>&1");
                    return { success: true, connected: true, output: result.stdout.trim() };
                case "dns":
                    result = await execAsync(`dig ${params.domain || "google.com"} +short 2>&1`);
                    return { success: true, resolved: result.stdout.trim() };
                case "ports":
                    result = await execAsync("ss -tlnp 2>&1");
                    return { success: true, listening_ports: result.stdout.trim() };
                default:
                    return { success: false, error: `Unknown: ${action}` };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    web_search: async ({ query, count = 5 }) => {
        logger.info(`[TOOL:web_search] "${query}"`);
        const UA = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        const decode = (s) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
        try {
            const results = [];
            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            const response = await fetch(searchUrl, {
                headers: { "User-Agent": UA },
                signal: AbortSignal.timeout(10000),
            });
            const html = await response.text();

            const linkRegex = /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
            const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div|span)/g;

            const titles = [];
            let m;
            while ((m = linkRegex.exec(html)) !== null) {
                let url = m[1];
                if (url.includes("uddg=")) {
                    try { const parsed = new URL(url, "https://duckduckgo.com"); url = parsed.searchParams.get("uddg") || url; } catch(_) {}
                }
                titles.push({ title: decode(m[2]), url });
            }

            const snippets = [];
            while ((m = snippetRegex.exec(html)) !== null) {
                snippets.push(decode(m[1]));
            }

            for (let i = 0; i < Math.min(titles.length, count); i++) {
                results.push({ title: titles[i].title, url: titles[i].url, snippet: snippets[i] || "" });
            }

            let instant = null;
            try {
                const iaResp = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
                    headers: { "User-Agent": UA },
                    signal: AbortSignal.timeout(5000),
                });
                const ia = await iaResp.json();
                if (ia.Abstract) instant = { abstract: ia.Abstract, source: ia.AbstractSource, url: ia.AbstractURL };
                else if (ia.Answer) instant = { abstract: ia.Answer, source: "DuckDuckGo", url: "" };
            } catch (_) {}

            return { success: true, query, results, instant, count: results.length };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    web_fetch: async ({ url, maxChars = 5000 }) => {
        logger.info(`[TOOL:web_fetch] ${url}`);
        try {
            const response = await fetch(url, {
                headers: { "User-Agent": "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36", "Accept": "text/html,text/plain" },
                signal: AbortSignal.timeout(10000),
                redirect: "follow",
            });
            let text = await response.text();
            if (typeof text === "string" && text.includes("<")) {
                text = text
                    .replace(/<script[\s\S]*?<\/script>/gi, "")
                    .replace(/<style[\s\S]*?<\/style>/gi, "")
                    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
                    .replace(/<header[\s\S]*?<\/header>/gi, "")
                    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
                    .replace(/<br\s*\/?>/gi, "\n")
                    .replace(/<\/p>/gi, "\n\n")
                    .replace(/<\/h[1-6]>/gi, "\n\n")
                    .replace(/<\/li>/gi, "\n")
                    .replace(/<\/tr>/gi, "\n")
                    .replace(/<\/td>/gi, " | ")
                    .replace(/<[^>]*>/g, "")
                    .replace(/&nbsp;/g, " ")
                    .replace(/&amp;/g, "&")
                    .replace(/&lt;/g, "<")
                    .replace(/&gt;/g, ">")
                    .replace(/&quot;/g, '"')
                    .replace(/&#x27;/g, "'")
                    .replace(/\n{3,}/g, "\n\n")
                    .trim();
            }
            if (text.length > maxChars) text = text.substring(0, maxChars) + "\n... (troncato)";
            return { success: true, url, content: text, length: text.length };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    eth_balance: async ({ address, chain = "arbitrum" }) => {
        let configRpc = null;
        if (factorBridge.ready) {
            try {
                const config = await factorBridge.callTool("factor_get_config", {});
                if (!address) {
                    const activeWalletName = config?.runtime?.activeWallet || config?.configFile?.content?.activeWallet;
                    const wallets = config?.wallets || [];
                    const active = wallets.find(w => w.isActive || w.name === activeWalletName);
                    address = active?.address;
                }
                if (config?.runtime?.chain) chain = config.runtime.chain;
                if (config?.runtime?.rpcUrl) configRpc = config.runtime.rpcUrl;
                logger.info(`[TOOL:eth_balance] Auto-detected: ${address} on ${chain} via ${configRpc || "fallback"}`);
            } catch (e) {
                logger.warn(`[TOOL:eth_balance] Auto-detect failed: ${e.message}`);
            }
        }
        if (!address) return { success: false, error: "No address provided and no active wallet found" };
        logger.info(`[TOOL:eth_balance] ${address} on ${chain}`);
        const chainMap = {
            arbitrum: "arbitrum", arbitrum_one: "arbitrum", arb: "arbitrum",
            base: "base",
            mainnet: "mainnet", ethereum: "mainnet", eth: "mainnet",
        };
        const fallbackRpcs = {
            arbitrum: "https://arb1.arbitrum.io/rpc",
            base: "https://mainnet.base.org",
            mainnet: "https://eth.llamarpc.com",
        };
        const normalizedChain = chainMap[chain.toLowerCase()] || "arbitrum";
        const rpc = configRpc || fallbackRpcs[normalizedChain];
        try {
            const { stdout } = await execAsync(`cast balance ${address} --rpc-url ${rpc} 2>/dev/null`);
            const wei = stdout.trim();
            const eth = (BigInt(wei) * 10000n / BigInt(1e18)).toString();
            const ethFormatted = (Number(eth) / 10000).toFixed(4);
            return { success: true, address, chain, balance: ethFormatted + " ETH", wei };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    minimax_auth: async () => {
        logger.info("[TOOL:minimax_auth] Starting OAuth flow");
        try {
            if (MiniMaxOAuth.hasOAuth() && !MiniMaxOAuth.isExpired()) {
                return { success: true, message: "Already authenticated via OAuth", expires: MiniMaxOAuth.tokens.expires };
            }
            const result = await MiniMaxOAuth.startAuth();
            return {
                success: true,
                message: `Open this URL and enter the code to authenticate:\n\nURL: ${result.verification_uri}\nCode: ${result.user_code}\n\nWaiting for approval...`,
                user_code: result.user_code,
                verification_uri: result.verification_uri,
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    agent_start: async () => { logger.info("[TOOL:agent_start]"); return startAgentLoop(); },
    agent_stop: async () => { logger.info("[TOOL:agent_stop]"); return stopAgentLoop(); },

    agent_status: async () => {
        logger.info("[TOOL:agent_status]");
        const recent = await AgentMemory.getRecent(5);
        return {
            running: agentLoopRunning,
            cycles: agentCycleCount,
            interval: `${AGENT_INTERVAL_MS / 1000}s`,
            discordThread: DISCORD_THREAD_ID,
            recentCycles: recent.map(e => ({ cycle: e.cycle, type: e.type, summary: (e.summary || "").substring(0, 100), tools: e.tools })),
        };
    },

    agent_journal: async ({ count = 10 } = {}) => {
        logger.info(`[TOOL:agent_journal] last ${count}`);
        const entries = await AgentMemory.getRecent(count);
        return { entries: entries.map(e => ({ cycle: e.cycle, type: e.type, summary: (e.summary || "").substring(0, 200), tools: e.tools, timestamp: e.timestamp })) };
    },

    process: async ({ action, params = {} }) => {
        logger.info(`[TOOL:process] ${action}`);
        try {
            let result;
            switch (action) {
                case "list":
                    result = await execAsync("ps aux --sort=-%mem | head -20");
                    return { success: true, processes: result.stdout.trim() };
                case "kill":
                    if (!params.pid) return { success: false, error: "PID required" };
                    await execAsync(`sudo kill ${params.signal || "-15"} ${params.pid}`);
                    return { success: true, killed: params.pid };
                case "find":
                    result = await execAsync(`pgrep -la "${params.name || ""}"`);
                    return { success: true, found: result.stdout.trim() };
                default:
                    return { success: false, error: `Unknown: ${action}` };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
};

// ─── Factor MCP Bridge — No timeout ─────────────────────────────────────────
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
            logger.warn("[FACTOR] MCP server not found at " + this.mcpPath);
            return false;
        }

        this.process = spawn("node", [this.mcpPath], {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env },
        });

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

        this.process.stderr.on("data", (data) => {
            const msg = data.toString().trim();
            if (msg) logger.info(`[FACTOR:stderr] ${msg.substring(0, 200)}`);
        });

        this.process.on("exit", (code) => {
            logger.warn(`[FACTOR] MCP process exited with code ${code}`);
            this.ready = false;
            setTimeout(() => this.start(), 5000);
        });

        try {
            const initResult = await this.send("initialize", {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "Andrea0x.eth_Claw", version: "2.0.0" },
            });
            logger.info(`[FACTOR] MCP init: ${JSON.stringify(initResult).substring(0, 200)}`);
            this.notify("notifications/initialized");
            this.ready = true;
            logger.info("[FACTOR] MCP bridge connected");
            return true;
        } catch (e) {
            logger.error(`[FACTOR] Init failed: ${e.message}`);
            return false;
        }
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.process) return reject(new Error("MCP not running"));
            const id = ++this.requestId;
            const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
            this.pending.set(id, (response) => {
                if (response.error) reject(new Error(response.error.message || JSON.stringify(response.error)));
                else resolve(response.result);
            });
            this.process.stdin.write(msg);
            // No timeout — let MCP calls complete naturally
        });
    }

    notify(method, params = {}) {
        if (!this.process) return;
        const msg = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
        this.process.stdin.write(msg);
    }

    async callTool(name, args = {}) {
        if (!this.ready) throw new Error("Factor MCP not connected");
        logger.info(`[FACTOR] ${name}(${JSON.stringify(args).substring(0, 100)})`);
        const result = await this.send("tools/call", { name, arguments: args });
        const text = result?.content?.map(c => c.text || "").join("") || JSON.stringify(result);
        const parsed = (() => { try { return JSON.parse(text); } catch { return { result: text }; } })();
        if (result?.isError) {
            parsed._isError = true;
            logger.warn(`[FACTOR] Tool ${name} returned error: ${text.substring(0, 200)}`);
        }
        return parsed;
    }

    async listTools() {
        if (!this.ready) return [];
        const result = await this.send("tools/list", {});
        return result?.tools || [];
    }
}

const factorBridge = new FactorMCPBridge(CONFIG.factorMcpPath);

// Factor bridge tool for AI
tools.factor = async ({ tool, params = {} }) => {
    logger.info(`[TOOL:factor] ${tool}`);
    try {
        return await factorBridge.callTool(tool, params);
    } catch (error) {
        return { success: false, error: error.message };
    }
};

// ─── Discord Webhook (set via env; do not commit secrets) ────────────────────
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const DISCORD_THREAD_ID = process.env.DISCORD_THREAD_ID || "";

async function sendDiscordMessage(content) {
    if (!DISCORD_WEBHOOK_URL) {
        logger.warn("[DISCORD] No webhook URL configured");
        return false;
    }
    try {
        const url = `${DISCORD_WEBHOOK_URL}?thread_id=${DISCORD_THREAD_ID}`;
        const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: content.substring(0, 2000),
                username: "Andrea0x.eth_Claw",
            }),
        });
        if (!resp.ok) {
            logger.warn(`[DISCORD] Webhook failed: ${resp.status} ${await resp.text()}`);
            return false;
        }
        logger.info("[DISCORD] Message sent to thread");
        return true;
    } catch (e) {
        logger.warn(`[DISCORD] Webhook error: ${e.message}`);
        return false;
    }
}

// ─── Agent Memory / Journal ──────────────────────────────────────────────────
const JOURNAL_DIR = path.join(CONFIG.dataDir, "agent-journal");
await fs.mkdir(JOURNAL_DIR, { recursive: true });

const AgentMemory = {
    async log(entry) {
        const timestamp = new Date().toISOString();
        const file = path.join(JOURNAL_DIR, `${timestamp.split("T")[0]}.jsonl`);
        await fs.appendFile(file, JSON.stringify({ ...entry, timestamp }) + "\n");
    },

    async getRecent(count = 20) {
        try {
            const files = (await fs.readdir(JOURNAL_DIR)).filter(f => f.endsWith(".jsonl")).sort().reverse();
            const entries = [];
            for (const file of files) {
                if (entries.length >= count) break;
                const lines = (await fs.readFile(path.join(JOURNAL_DIR, file), "utf8")).trim().split("\n");
                for (const line of lines.reverse()) {
                    if (entries.length >= count) break;
                    try { entries.push(JSON.parse(line)); } catch {}
                }
            }
            return entries;
        } catch { return []; }
    },

    async getSummary() {
        const recent = await this.getRecent(10);
        if (recent.length === 0) return "No previous actions. This is your first session.";
        return recent.map(e => `[${e.timestamp}] ${e.type}: ${e.summary || ""}`.substring(0, 150)).join("\n");
    },
};

// ─── Autonomous Agent Loop ───────────────────────────────────────────────────
let agentLoopRunning = false;
let agentLoopTimer = null;
let agentCycleCount = 0;
let autonomousCycleActive = false;
const AGENT_INTERVAL_MS = 30 * 60 * 1000;

const AUTONOMOUS_BLOCKED_TOOLS = new Set([
    "factor_execute_strategy",
    "factor_deposit",
    "factor_withdraw",
    "factor_execute_manager",
    "factor_create_vault",
]);

// ─── Error Memory ────────────────────────────────────────────────────────────
const ERROR_MEMORY_PATH = "/data/agent-journal/error-memory.jsonl";

async function loadErrorMemory() {
    try {
        const data = await fs.readFile(ERROR_MEMORY_PATH, "utf8");
        const lines = data.trim().split("\n").filter(Boolean);
        const errors = lines.slice(-30).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        if (!errors.length) return "";
        const summary = errors.map(e => `- [${e.tool}] ${e.error.substring(0, 120)}`).join("\n");
        return `\n=== ERROR MEMORY (DO NOT REPEAT THESE) ===\n${summary}\n`;
    } catch { return ""; }
}

async function saveError(tool, error, params = "") {
    try {
        const entry = JSON.stringify({ ts: new Date().toISOString(), tool, error: String(error).substring(0, 300), params: String(params).substring(0, 200) });
        await fs.appendFile(ERROR_MEMORY_PATH, entry + "\n", "utf8");
        logger.info(`[ERROR_MEM] Saved: ${tool} -> ${String(error).substring(0, 80)}`);
    } catch (e) {
        logger.warn(`[ERROR_MEM] Write failed: ${e.message}`);
    }
}

async function runAgentCycle() {
    agentCycleCount++;
    const cycleId = `agent-${agentCycleCount}`;
    logger.info(`[AGENT] ═══ Cycle #${agentCycleCount} START ═══`);
    autonomousCycleActive = true;

    try {
        const memorySummary = await AgentMemory.getSummary();
        let notes = "";
        try { notes = (await fs.readFile("/data/agent-journal/notes.md", "utf8")).substring(0, 1000); } catch {}
        const errorContext = await loadErrorMemory();
        const memoryContext = memorySummary + (notes ? `\nNotes: ${notes}` : "") + errorContext;

        let previousYields = "";
        try {
            const yf = await fs.readFile("/data/agent-journal/yield-reports.md", "utf8");
            const lastReport = yf.split("\n## ").pop() || "";
            previousYields = lastReport ? `\nLast report summary:\n${lastReport.substring(0, 500)}` : "";
        } catch {}

        const message = `Autonomous cycle #${agentCycleCount}. MISSION: Yield Scan + Strategy Build.
${previousYields}

${memoryContext}

EXECUTE THIS PROTOCOL:
1. Run the yield scanner: [TOOL_CALL:shell:{"command":"node /opt/openclaw/scripts/yield-scanner.js --limit 15"}]
2. Analyze results: which pools have the best risk-adjusted yields? Consider TVL, stablecoin status, IL risk, APY trend.
3. Build a Factor strategy for the best opportunity using factor_build_strategy + factor_simulate_strategy. Consider leveraged lending via BalancerFlashloan if lending APY is high. Use OpenOcean for swaps.
4. Save the report to /data/agent-journal/yield-reports.md
5. Post a concise summary.

RULES: NEVER execute strategies. Only build + simulate. NEVER create wallets.`;

        const result = await ai.chat(message, cycleId, AGENT_PROMPT, { maxRounds: 10 });
        const response = result.response || "(no response)";

        await AgentMemory.log({
            type: "cycle",
            cycle: agentCycleCount,
            summary: response.substring(0, 500),
            tokens: result.tokens,
        });

        const discordMsg = `🧠 **Cycle #${agentCycleCount}**\n\n${response.substring(0, 1800)}`;
        await sendDiscordMessage(discordMsg);

        logger.info(`[AGENT] ═══ Cycle #${agentCycleCount} DONE (${result.tokens?.total_tokens || 0} tokens) ═══`);
    } catch (error) {
        logger.error(`[AGENT] Cycle #${agentCycleCount} FAILED: ${error.message}`);
        await AgentMemory.log({ type: "error", cycle: agentCycleCount, summary: `Error: ${error.message}` });
        await sendDiscordMessage(`⚠️ **Cycle #${agentCycleCount} error**\n\`\`\`${error.message.substring(0, 500)}\`\`\``);
    } finally {
        autonomousCycleActive = false;
    }

    ai.clearHistory(cycleId);
}

function startAgentLoop() {
    if (agentLoopRunning) return { running: true, message: "Already running" };
    agentLoopRunning = true;
    logger.info(`[AGENT] Autonomous mode ACTIVATED (interval: ${AGENT_INTERVAL_MS / 1000}s)`);
    runAgentCycle();
    agentLoopTimer = setInterval(() => {
        if (agentLoopRunning) runAgentCycle();
    }, AGENT_INTERVAL_MS);
    return { running: true, interval: AGENT_INTERVAL_MS, message: "Agent loop started" };
}

function stopAgentLoop() {
    agentLoopRunning = false;
    if (agentLoopTimer) { clearInterval(agentLoopTimer); agentLoopTimer = null; }
    logger.info("[AGENT] Autonomous mode DEACTIVATED");
    return { running: false, cycles: agentCycleCount, message: "Agent loop stopped" };
}

// ─── Express API ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        agent: "Andrea0x.eth_Claw",
        uptime: process.uptime(),
        engine: "single-agent",
        model: CONFIG.minimaxModel,
        agents: ["openclaw"],
        auth: {
            oauth: MiniMaxOAuth.hasOAuth(),
            expired: MiniMaxOAuth.hasOAuth() ? MiniMaxOAuth.isExpired() : null,
            fallbackKey: !!_minimaxKey,
        },
        factorMcp: factorBridge.ready,
    });
});

// ─── MiniMax OAuth Auth Endpoints ────────────────────────────────────────────
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

app.get("/auth/minimax/status", (req, res) => {
    if (MiniMaxOAuth.hasOAuth()) {
        return res.json({ authenticated: true, expired: MiniMaxOAuth.isExpired(), expires: MiniMaxOAuth.tokens?.expires });
    }
    if (MiniMaxOAuth.pendingAuth) {
        return res.json({ authenticated: false, pending: MiniMaxOAuth.pendingAuth.polling, completed: MiniMaxOAuth.pendingAuth.completed || false, error: MiniMaxOAuth.pendingAuth.error || null });
    }
    res.json({ authenticated: false, pending: false, fallbackKey: !!_minimaxKey });
});

app.post("/auth/minimax/refresh", async (req, res) => {
    try {
        const tokens = await MiniMaxOAuth.refreshToken();
        res.json({ success: true, expires: tokens.expires });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/chat", async (req, res) => {
    const { message, chatId = "default" } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    try {
        // Inject error memory into context
        const errorCtx = await loadErrorMemory();
        const enrichedMessage = errorCtx ? message + "\n" + errorCtx : message;
        const result = await ai.chat(enrichedMessage, chatId, AGENT_PROMPT, { maxRounds: 10 });

        // Log to journal
        await AgentMemory.log({
            type: "chat",
            chatId,
            summary: (result.response || "").substring(0, 300),
            tokens: result.tokens,
        });

        // Post to Discord
        if (result.response) {
            await sendDiscordMessage(`🧠 ${result.response.substring(0, 1900)}`);
        }

        res.json(result);
    } catch (error) {
        const status = error.response?.status || 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

app.post("/chat/clear", (req, res) => {
    const { chatId = "default" } = req.body;
    ai.clearHistory(chatId);
    res.json({ success: true });
});

app.post("/tool/:name", async (req, res) => {
    const t = req.params.name;
    if (!tools[t]) return res.status(404).json({ error: `Tool '${t}' not found` });
    try {
        res.json(await tools[t](req.body));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/tools", (req, res) => { res.json({ tools: Object.keys(tools) }); });
app.get("/system", async (req, res) => { res.json(await tools.system_info()); });

app.get("/ai/config", (req, res) => {
    res.json({
        engine: "single-agent",
        model: CONFIG.minimaxModel,
        auth: {
            oauth: MiniMaxOAuth.hasOAuth(),
            expired: MiniMaxOAuth.hasOAuth() ? MiniMaxOAuth.isExpired() : null,
            fallbackKey: !!_minimaxKey,
        },
        factorMcp: factorBridge.ready,
    });
});

app.post("/factor", async (req, res) => {
    const { tool, params = {} } = req.body;
    if (!tool) return res.status(400).json({ error: "tool required" });
    try {
        const result = await factorBridge.callTool(tool, params);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/factor/tools", async (req, res) => {
    try {
        const factorTools = await factorBridge.listTools();
        res.json({ tools: factorTools });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── Autonomous Agent Endpoints ──────────────────────────────────────────────
app.post("/agent/start", (req, res) => { res.json(startAgentLoop()); });
app.post("/agent/stop", (req, res) => { res.json(stopAgentLoop()); });

app.get("/agent/status", (req, res) => {
    res.json({
        running: agentLoopRunning,
        cycles: agentCycleCount,
        interval: AGENT_INTERVAL_MS,
        discordThread: DISCORD_THREAD_ID,
        webhook: DISCORD_WEBHOOK_URL ? "configured" : "not set",
    });
});

app.get("/agent/journal", async (req, res) => {
    const count = parseInt(req.query.count) || 20;
    const entries = await AgentMemory.getRecent(count);
    res.json({ entries, count: entries.length });
});

app.post("/agent/discord-test", async (req, res) => {
    const sent = await sendDiscordMessage("🧠 **Andrea0x.eth_Claw** webhook activated!");
    res.json({ success: sent });
});

app.post("/agent/cycle", async (req, res) => {
    res.json({ started: true, cycle: agentCycleCount + 1 });
    runAgentCycle();
});

app.get("/feedback", async (req, res) => {
    try { const content = await fs.readFile("/data/agent-journal/factor-mcp-feedback.md", "utf8"); res.type("text/markdown").send(content); }
    catch (e) { res.status(404).send("# No feedback yet\n"); }
});

app.get("/feedback.json", async (req, res) => {
    try {
        const content = await fs.readFile("/data/agent-journal/factor-mcp-feedback.md", "utf8");
        const sections = content.split(/\n---\n/).filter(s => s.trim());
        res.json({ count: sections.length, updated: new Date().toISOString(), content });
    } catch (e) { res.json({ count: 0, content: "" }); }
});

app.get("/yields", async (req, res) => {
    try { const content = await fs.readFile("/data/agent-journal/yield-reports.md", "utf8"); res.type("text/markdown").send(content); }
    catch (e) { res.status(404).send("# No yield reports yet\nThe autonomous yield scanner has not run yet.\n"); }
});

app.get("/yields.json", async (req, res) => {
    try {
        const content = await fs.readFile("/data/agent-journal/yield-reports.md", "utf8");
        const sections = content.split(/\n## /).filter(s => s.trim());
        res.json({ count: sections.length, updated: new Date().toISOString(), content });
    } catch (e) { res.json({ count: 0, content: "" }); }
});

app.get("/yields/live", async (req, res) => {
    try {
        const { execSync } = await import("child_process");
        let output, stderr = "";
        try {
            output = execSync("node /opt/openclaw/scripts/yield-scanner.js --limit 20", { timeout: 15000, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
        } catch (e) {
            stderr = (e.stderr || e.stdout || e.message || "").toString().trim().slice(0, 500);
            return res.status(502).json({ error: "Yield scanner failed", detail: stderr || e.message, pools: [], count: 0 });
        }
        const trimmed = (output || "").toString().trim();
        if (!trimmed) return res.status(502).json({ error: "Yield scanner returned empty output", detail: stderr, pools: [], count: 0 });
        try {
            const data = JSON.parse(trimmed);
            if (data && typeof data.error === "string") return res.status(502).json({ error: data.error, pools: data.pools || [], count: (data.pools && data.pools.length) || 0 });
            return res.json(data);
        } catch (parseErr) {
            return res.status(502).json({ error: "Invalid JSON from yield scanner", detail: trimmed.slice(0, 200) + (trimmed.length > 200 ? "..." : ""), pools: [], count: 0 });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── Monitoring ─────────────────────────────────────────────────────────────
cron.schedule(CONFIG.decisionInterval, async () => {
    try {
        const info = await tools.system_info();
        const tempMatch = info.temperature?.match(/([\d.]+)/);
        if (tempMatch && parseFloat(tempMatch[1]) > 75)
            logger.warn(`[CRON] Temp alta: ${info.temperature}`);
        const memMatch = info.memory?.match(/([\d.]+)%/);
        if (memMatch && parseFloat(memMatch[1]) > 90)
            logger.warn(`[CRON] RAM alta: ${info.memory}`);
    } catch (error) {
        logger.error(`[CRON] ${error.message}`);
    }
});

// ─── Start ──────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { registerDashboardRoutes } = await import(path.join(__dirname, "dashboard-routes.js"));
registerDashboardRoutes(app);

app.listen(CONFIG.port, "0.0.0.0", async () => {
    logger.info(`Andrea0x.eth_Claw running on :${CONFIG.port} (single-agent)`);
    logger.info(`AI: MiniMax ${CONFIG.minimaxModel} (OAuth: ${MiniMaxOAuth.hasOAuth() ? "yes" : "no"}, Key fallback: ${_minimaxKey ? "yes" : "no"})`);
    logger.info(`Discord: Webhook ${DISCORD_WEBHOOK_URL ? "configured" : "NOT set"}, Thread: ${DISCORD_THREAD_ID}`);
    logger.info(`Tools: ${Object.keys(tools).join(", ")}`);

    const factorOk = await factorBridge.start();
    if (factorOk) {
        logger.info("[FACTOR] MCP bridge ready - DeFi tools active");
    } else {
        logger.warn("[FACTOR] MCP bridge not available - DeFi tools disabled");
    }

    if (MiniMaxOAuth.hasOAuth() && factorOk) {
        logger.info("[AGENT] OAuth + Factor ready - auto-starting autonomous loop in 10s...");
        setTimeout(() => startAgentLoop(), 10000);
    } else {
        logger.info("[AGENT] Autonomous mode available via POST /agent/start");
    }
});
