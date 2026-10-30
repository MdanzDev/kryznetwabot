// lib/internal-api.js — HTTP surface the Kryz-Net API server calls to make the
// bot act (send OTPs, order notifications, arbitrary messages).
//
// Transport: the API server runs on a DIFFERENT host and reaches this box
// through a reverse SSH tunnel, so all traffic stays on loopback and BOT_URL
// stays 127.0.0.1. Never bind this publicly.
//
// Auth: every request must carry X-API-Key equal to BOT_API_KEY (.env).
// The bot aborts startup when that key is absent rather than serving open.
"use strict";
const http = require("node:http");
const crypto = require("node:crypto");

const MAX_BODY = 64 * 1024;
const SEND_TIMEOUT_MS = 20_000;

// Constant-time compare so a wrong key cannot be recovered by timing.
const safeEqual = (a, b) => {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
};

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (c) => {
            size += c.length;
            if (size > MAX_BODY) {
                reject(Object.assign(new Error("body too large"), { status: 413 }));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => {
            try {
                resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
            } catch {
                reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
            }
        });
        req.on("error", reject);
    });
}

// Bare international digits -> WhatsApp PN JID. Already-formed JIDs pass through.
const toJid = (raw) => {
    const s = String(raw || "").trim();
    if (!s) return null;
    if (s.includes("@")) return s;
    const digits = s.replace(/\D/g, "");
    return digits ? `${digits}@s.whatsapp.net` : null;
};

function createInternalApi({ bot, apiKey, port, log = console.log }) {
    if (!apiKey) throw new Error("BOT_API_KEY missing — refusing to serve an open internal API");

    const send = async (jid, text) => {
        const to = toJid(jid);
        if (!to) throw Object.assign(new Error("jid required"), { status: 400 });
        if (!text || !String(text).trim()) throw Object.assign(new Error("text required"), { status: 400 });
        await Promise.race([
            bot.sendMessage(to, { text: String(text) }),
            new Promise((_, rej) => setTimeout(() => rej(new Error("send timeout")), SEND_TIMEOUT_MS))
        ]);
        return to;
    };

    const routes = {
        "/wa/send": async (body) => ({ sent: await send(body.jid, body.text) }),

        "/api/internal/send-otp": async (body) => {
            const to = await send(body.phone, `🔐 *Kod OTP Kryz-Net*\n\n${body.otp}\n\nJangan kongsi kod ni dengan sesiapa.`);
            return { sent: to };
        },

        "/api/internal/send-notification": async (body) => ({ sent: await send(body.jid, body.text) }),

        "/api/internal/order-created": async (body) => {
            const lines = [
                `🧾 *Pesanan baru #${body.orderId || "-"}*`,
                body.gameName || body.productName ? `🎮 ${body.gameName || ""} — ${body.productName || ""}`.trim() : null,
                body.chargeAmount ? `💳 RM${body.chargeAmount}` : null,
                body.payUrl ? `🔗 ${body.payUrl}` : null
            ].filter(Boolean);
            const results = {};
            // The order event names a phone and/or a jid; notify whichever exist.
            for (const target of [body.whatsappJid, body.phone]) {
                if (!target) continue;
                try {
                    results[target] = await send(target, lines.join("\n"));
                } catch (e) {
                    results[target] = `failed: ${e.message}`;
                }
            }
            return { notified: results };
        }
    };

    const server = http.createServer(async (req, res) => {
        const json = (code, payload) => {
            res.writeHead(code, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
        };

        if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
        if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });

        const path = String(req.url || "").split("?")[0];
        const handler = routes[path];
        if (!handler) return json(404, { ok: false, error: "unknown endpoint" });

        if (!safeEqual(req.headers["x-api-key"] || "", apiKey)) {
            log(`[internal-api] 401 unauthorized ${path}`);
            return json(401, { ok: false, error: "unauthorized" });
        }

        try {
            const body = await readBody(req);
            const result = await handler(body);
            json(200, { ok: true, ...result });
        } catch (err) {
            const status = err.status || (err.message === "send timeout" ? 504 : 500);
            log(`[internal-api] ${status} ${path}: ${err.message}`);
            json(status, { ok: false, error: err.message });
        }
    });

    server.listen(port, "127.0.0.1", () => log(`[internal-api] listening on 127.0.0.1:${port} (4 endpoints, key required)`));
    server.on("error", (e) => {
        log(`[internal-api] failed to start: ${e.message} — API pushes will not be delivered`);
    });
    return server;
}

module.exports = { createInternalApi, toJid };
