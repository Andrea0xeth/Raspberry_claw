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
        description: "Check vault 0xbad0d504b0b03443547e65ba9bf5ca47ecf644dc, trigger DeFi Expert, Executor, System Improver, post to Discord",
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

    if (started > 0) {
        log(`[CRON] ${started} job(s) active. Health: GET ${baseUrl}/heartbeat or GET ${baseUrl}/HEARTBEAT`);
    }
    return started;
}
