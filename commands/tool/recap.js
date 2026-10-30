// recap.js — "apa yang aku terlepas?"
//
// The bot already writes a conversation summary every ~8 messages
// (database/alya.db `summaries`, 96 rows at time of writing) and nothing ever
// read them back. This is a thin read of data that already exists.
"use strict";

const digits = (j = "") => String(j).split("@")[0].split(":")[0].replace(/\D/g, "");

function chatIdFor(ctx) {
    const tg = ctx.bot?.waAlya?.tg;
    if (ctx.sender.isOwner()) return String(tg?.config?.ownerIds?.[0] || "wa_owner");
    if (ctx.isGroup()) return "wag_" + ctx.id;
    return "wa_" + (digits(ctx.sender.jid) || digits(ctx.sender.lid) || "unknown");
}

// "2h" -> ms. Bare number means hours.
function parseWindow(raw) {
    const m = String(raw || "").trim().match(/^(\d+)\s*(m|min|minit|h|jam|d|hari)?$/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const u = (m[2] || "h").toLowerCase();
    const ms = u.startsWith("m") ? 60_000 : (u === "h" || u === "jam") ? 3_600_000 : 86_400_000;
    return n * ms;
}

const ago = (ts) => {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 60) return `${mins}m lalu`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}j lalu`;
    return `${Math.round(h / 24)}h lalu`;
};

module.exports = {
    name: "recap",
    aliases: ["ringkasan", "missed", "rangkuman"],
    category: "tool",
    description: "Ringkasan perbualan — apa yang berlaku masa kau takde",
    cooldown: 5,
    code: async (ctx) => {
        const store = ctx.bot?.waAlya?.tg?.store;
        if (!store) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Store tak aktif."));

        const chatId = chatIdFor(ctx);
        const windowMs = parseWindow(ctx.text) || 6 * 3_600_000; // default: last 6h
        const limit = Math.min(12, Math.max(1, Math.round(windowMs / 3_600_000) || 3));

        // recentSummaries returns newest-first; pull a few more than the window
        // so we can filter by age and still have something to show.
        let rows = [];
        try {
            rows = store.recentSummaries(chatId, limit) || [];
        } catch (e) {
            return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Gagal baca ringkasan."));
        }

        if (!rows.length) {
            return await ctx.reply(ctx.format.info(
                "(｡･ω･｡) Belum ada ringkasan lagi untuk chat ni.\n" +
                "Alya mula ringkaskan selepas beberapa mesej."
            ));
        }

        const items = rows.map((r) => {
            const when = r.created_at ? ago(r.created_at) : "";
            return `♡ ${when}\n${String(r.summary).slice(0, 400)}`;
        });

        return await ctx.reply(ctx.format.info(
            `❖ *Recap* — ${ctx.isGroup() ? "grup ni" : "chat ni"}\n\n` +
            items.join("\n\n") +
            `\n\n♡ ${ctx.used?.prefix || "."}recap 24h untuk tempoh lebih panjang`
        ));
    }
};
