#!/usr/bin/env node
/**
 * Telegram bridge for 0xpiclaw.eth agent
 * Forwards Telegram messages to OpenClaw POST /chat and sends the response back.
 * Env: TELEGRAM_BOT_TOKEN (required), OPENCLAW_CHAT_URL (default http://127.0.0.1:3100/chat)
 */

const AGENT_PORT = process.env.OPENCLAW_PORT || "3100";
const CHAT_URL = process.env.OPENCLAW_CHAT_URL || `http://127.0.0.1:${AGENT_PORT}/chat`;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const POLL_TIMEOUT = 30;

if (!BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is required. Set it in the environment or in the systemd service.");
    process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function telegramApi(method, body = null) {
    const url = body ? `${TELEGRAM_API}/${method}` : `${TELEGRAM_API}/${method}`;
    const res = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || "Telegram API error");
    return data.result;
}

async function sendMessage(chatId, text, opts = {}) {
    const body = { chat_id: chatId, text: String(text).slice(0, 4096), ...opts };
    return telegramApi("sendMessage", body);
}

async function getUpdates(offset) {
    const url = `${TELEGRAM_API}/getUpdates?timeout=${POLL_TIMEOUT}&offset=${offset || 0}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || "getUpdates failed");
    return data.result;
}

async function agentChat(message, chatId = "default") {
    const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, chatId }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Agent error ${res.status}: ${err}`);
    }
    const data = await res.json();
    return data.response || data.error || "(no response)";
}

async function processUpdate(update) {
    const msg = update.message;
    if (!msg?.text) return update.update_id;
    const chatId = msg.chat.id;
    const from = msg.from?.username || msg.from?.first_name || "user";
    const text = msg.text.trim();
    if (!text) return update.update_id;

    console.log(`[Telegram] ${from}: ${text.slice(0, 80)}`);
    try {
        const response = await agentChat(text, `telegram-${chatId}`);
        await sendMessage(chatId, response);
    } catch (e) {
        console.error("[Telegram] Error:", e.message);
        await sendMessage(chatId, `Errore: ${e.message}`).catch(() => {});
    }
    return update.update_id;
}

async function run() {
    console.log(`[Telegram bridge] CHAT_URL=${CHAT_URL}`);
    let offset = 0;
    for (;;) {
        try {
            const updates = await getUpdates(offset);
            for (const u of updates) {
                offset = Math.max(offset, u.update_id + 1);
                await processUpdate(u);
            }
        } catch (e) {
            console.error("[Telegram] Poll error:", e.message);
            await new Promise((r) => setTimeout(r, 5000));
        }
    }
}

run();
