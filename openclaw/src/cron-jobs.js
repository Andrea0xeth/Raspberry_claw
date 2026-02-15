/**
 * OpenClaw cron jobs — single place for all scheduled tasks.
 * Used by the orchestrator (and optionally other agents). In-process scheduling
 * runs these by POSTing to local endpoints. External cron can hit /heartbeat
 * or /HEARTBEAT for health checks, or POST /cron/orchestrate with CRON_SECRET.
 */

/**
 * Cron vs Heartbeat (OpenClaw-style):
 * - Use cron for exact timing and isolated tasks (orchestrate, yield-optimize).
 * - Use heartbeat for batched periodic checks; agent reads HEARTBEAT.md and replies HEARTBEAT_OK if nothing.
 * See https://docs.openclaw.ai/automation/cron-vs-heartbeat
 */
export const CRON_JOBS = [
    {
        id: "heartbeat",
        name: "Heartbeat (HEARTBEAT.md checklist)",
        scheduleMs: 15 * 60 * 1000,
        method: "POST",
        path: "/heartbeat",
        description: "Proactive check: read HEARTBEAT.md, follow checklist; reply HEARTBEAT_OK if nothing. All agents.",
        roles: [], // all roles
    },
    {
        id: "orchestrate",
        name: "Orchestrator 30-min cycle",
        scheduleMs: 30 * 60 * 1000,
        method: "POST",
        path: "/cron/orchestrate",
        description: "Discover vaults via factor_get_owned_vaults, then for chosen vault(s) trigger DeFi Expert, Executor, System Improver, post to Discord",
        roles: ["orchestrator"],
    },
    {
        id: "yield-optimize",
        name: "Yield optimizer (Aave vs Compound)",
        scheduleMs: 60 * 60 * 1000,
        method: "POST",
        path: "/cron/yield-optimize",
        description: "Compare USDC APY Aave V3 vs Compound V3 on Arbitrum, rebalance vault if justified",
        roles: ["orchestrator"],
    },
];

// ─── Pi System Report → Discord Thread (every 30 min) ──────────────────────
const PI_REPORT_WEBHOOK = process.env.DISCORD_LOG_WEBHOOK || process.env.PI_REPORT_WEBHOOK || "";
const PI_REPORT_THREAD_ID = process.env.DISCORD_LOG_THREAD_ID || process.env.PI_REPORT_THREAD_ID || "";

// ─── Bitcoin price → Discord (every 5 min) ─────────────────────────────────
const COINGECKO_BTC = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true";

async function sendBtcPrice(log = () => {}) {
    try {
        const r = await fetch(COINGECKO_BTC);
        if (!r.ok) { log("[BTC] CoinGecko failed: " + r.status); return; }
        const data = await r.json();
        const btc = data.bitcoin;
        if (!btc || btc.usd == null) { log("[BTC] No price in response"); return; }
        const usd = typeof btc.usd === "number" ? btc.usd.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : btc.usd;
        const change = btc.usd_24h_change != null ? (btc.usd_24h_change >= 0 ? "+" : "") + btc.usd_24h_change.toFixed(2) + "% 24h" : "";
        const msgDiscord = `₿ Bitcoin: **$${usd}** ${change}`.trim();
        const msgTelegram = `₿ Bitcoin: $${usd} ${change}`.trim();

        if (PI_REPORT_WEBHOOK) {
            const url = PI_REPORT_THREAD_ID ? `${PI_REPORT_WEBHOOK}?thread_id=${PI_REPORT_THREAD_ID}` : PI_REPORT_WEBHOOK;
            const resp = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: msgDiscord, username: "piclaw-btc" }),
            });
            if (resp.ok || resp.status === 204) log("[BTC] sent to Discord");
            else log("[BTC] Discord error: " + resp.status);
        }

        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (token && chatId) {
            const tgUrl = `https://api.telegram.org/bot${token}/sendMessage`;
            const tgResp = await fetch(tgUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: msgTelegram }),
            });
            if (tgResp.ok) log("[BTC] sent to Telegram");
            else log("[BTC] Telegram error: " + tgResp.status);
        }
    } catch (e) {
        log("[BTC] error: " + e.message);
    }
}

async function sendPiSystemReport(log = () => {}) {
    try {
        const r = await fetch("http://127.0.0.1:3100/pi/system");
        if (!r.ok) { log("[PI-REPORT] /pi/system failed: " + r.status); return; }
        const s = await r.json();

        const temp = s.temperature ? `${s.temperature.value}°C` : "N/A";
        const throttle = s.throttled?.decoded?.join(", ") || "N/A";
        const load = s.load ? `${s.load.load1} / ${s.load.load5} / ${s.load.load15}` : "N/A";
        const mem = s.memory ? `${s.memory.usedMb}MB / ${s.memory.totalMb}MB (${s.memory.percentUsed}%)` : "N/A";
        const disks = (s.disks || []).map(d => `\`${d.mount}\` ${d.used}/${d.size} (${d.usePct})`).join("\n") || "N/A";
        const cpu = s.cpu ? `${s.cpu.model || "?"} × ${s.cpu.cores || "?"}` : "N/A";
        const clock = s.clockArm ? `${(parseInt(s.clockArm) / 1e6).toFixed(0)} MHz` : "N/A";
        const volt = s.volt || "N/A";
        const uptime = s.uptimeFormatted || "N/A";

        const report = [
            `## Raspberry Pi — System Report`,
            `\`${s.at || new Date().toISOString()}\``,
            ``,
            `**Hostname:** ${s.hostname || "N/A"}`,
            `**Uptime:** ${uptime}`,
            `**CPU:** ${cpu} @ ${clock}`,
            `**Temperature:** ${temp}`,
            `**Throttle:** ${throttle}`,
            `**Voltage:** ${volt}`,
            `**Load (1/5/15):** ${load}`,
            `**Memory:** ${mem}`,
            `**GPU:** ${s.gpuMem || "N/A"} | **ARM:** ${s.armMem || "N/A"}`,
            ``,
            `**Disks:**`,
            disks,
        ].join("\n").substring(0, 2000);

        if (PI_REPORT_WEBHOOK) {
            const url = PI_REPORT_THREAD_ID ? `${PI_REPORT_WEBHOOK}?thread_id=${PI_REPORT_THREAD_ID}` : PI_REPORT_WEBHOOK;
            const resp = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: report, username: "piclaw-system" }),
            });
            if (resp.ok || resp.status === 204) {
                log("[PI-REPORT] sent to Discord thread");
            } else {
                log("[PI-REPORT] Discord error: " + resp.status);
            }
        }
    } catch (e) {
        log("[PI-REPORT] error: " + e.message);
    }
}

/**
 * Start in-process cron intervals for this agent. Only jobs whose `roles` include
 * the current agent role are scheduled.
 * @param {Object} opts
 * @param {number} opts.port - Server port (e.g. 3100)
 * @param {string} [opts.secret] - CRON_SECRET for Authorization header
 * @param {string} [opts.agentRole] - OPENCLAW_AGENT_ROLE (orchestrator, etc.)
 * @param {Function} [opts.log] - (msg) => void
 */
export function startCronJobs(opts) {
    const { port, secret = "", agentRole = "", log = () => {} } = opts;
    const baseUrl = `http://127.0.0.1:${port}`;
    let started = 0;

    for (const job of CRON_JOBS) {
        const allowed = !job.roles || job.roles.length === 0 || (agentRole && job.roles.includes(agentRole));
        if (!allowed) continue;

        const url = baseUrl + job.path;
        const headers = { "Content-Type": "application/json" };
        if (secret) headers.Authorization = "Bearer " + secret;

        const run = async () => {
            try {
                const r = await fetch(url, { method: job.method, headers });
                const data = await r.json().catch(() => ({}));
                log(`[CRON] ${job.id}: ${r.ok && data.success ? "ok" : data.error || r.status}`);
            } catch (e) {
                log(`[CRON] ${job.id} error: ${e.message}`);
            }
        };

        const interval = setInterval(run, job.scheduleMs);
        run(); // run once at start
        started++;
        log(`[CRON] Scheduled: ${job.name} (every ${job.scheduleMs / 60000} min)`);
    }

    // Pi System Report → Discord (every 30 min)
    const piReportRun = () => sendPiSystemReport(log);
    setTimeout(piReportRun, 10000); // first report 10s after boot
    setInterval(piReportRun, 30 * 60 * 1000);
    started++;
    log(`[CRON] Scheduled: Pi System Report → Discord (every 30 min)`);

    // Bitcoin price → Discord (every 5 min)
    const btcRun = () => sendBtcPrice(log);
    setTimeout(btcRun, 30000); // first run 30s after boot
    setInterval(btcRun, 5 * 60 * 1000);
    started++;
    log(`[CRON] Scheduled: Bitcoin price → Discord (every 5 min)`);

    if (started > 0) {
        log(`[CRON] ${started} job(s) active. Health: GET ${baseUrl}/heartbeat or GET ${baseUrl}/HEARTBEAT`);
    }
    return started;
}
