// digest.js — what changed in this group lately.
//
// `.topsider`/`.topyapping` print a static ranking. This answers the different
// question an admin actually has: who is NEW and who has gone QUIET. Reuses
// lib/group-rank.js buildRanking() so the digest can never disagree with the
// board or with .kickidle.
"use strict";
const { buildRanking } = require("../../lib/group-rank");

const DAY = 86_400_000;

module.exports = {
    name: "digest",
    aliases: ["aktiviti", "laporan"],
    category: "group",
    description: "Ringkasan perubahan ahli grup (baru / senyap)",
    cooldown: 10,
    code: async (ctx) => {
        if (!ctx.isGroup()) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Khusus dalam grup."));
        if (!ctx.db.group) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Data grup tak ada."));

        // Days back: .digest 14 (default 7)
        const n = parseInt(String(ctx.text || "").trim(), 10);
        const days = Number.isFinite(n) && n > 0 && n <= 90 ? n : 7;
        const since = Date.now() - days * DAY;

        let rows;
        try {
            rows = (await buildRanking(ctx)) || [];
        } catch (e) {
            return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Gagal baca senarai ahli: ${e.message}`));
        }

        // Never count the bot or admins as "quiet" — they are not members to chase.
        const humans = rows.filter((r) => !r.isBot && !r.isAdmin && !r.isGroupOwner);

        const fresh = humans.filter((r) => r.firstSeen && r.firstSeen >= since);
        const quiet = humans
            .filter((r) => !r.firstSeen || r.firstSeen < since)   // not brand new
            .filter((r) => (r.sent || 0) === 0)
            .sort((a, b) => (a.firstSeen || 0) - (b.firstSeen || 0));
        const active = humans
            .filter((r) => (r.sent || 0) > 0)
            .sort((a, b) => (b.sent || 0) - (a.sent || 0));

        const fmt = (r) => `♡ ${String(r.name).slice(0, 24)} — ${r.sent || 0} mesej`;
        const p = ctx.used?.prefix || ".";

        const parts = [
            `❖ *Digest ${days} hari*`,
            `♡ ${humans.length} ahli (tanpa admin/bot)`,
            `♡ ${fresh.length} baru · ${quiet.length} senyap · ${active.length} aktif`,
            ""
        ];

        if (fresh.length) {
            parts.push(`✦ *Ahli baru*`);
            parts.push(...fresh.slice(0, 10).map((r) => `♡ ${String(r.name).slice(0, 24)}`));
            if (fresh.length > 10) parts.push(`… +${fresh.length - 10} lagi`);
            parts.push("");
        }

        if (quiet.length) {
            parts.push(`✦ *Senyap* (0 mesej sejak join)`);
            parts.push(...quiet.slice(0, 10).map(fmt));
            if (quiet.length > 10) parts.push(`… +${quiet.length - 10} lagi`);
            parts.push(`\n♡ Semak: ${p}kickidle`);
            parts.push("");
        }

        if (active.length) {
            parts.push(`✦ *Paling aktif*`);
            parts.push(...active.slice(0, 5).map(fmt));
            parts.push("");
        }

        if (!fresh.length && !quiet.length && !active.length) {
            parts.push("(tiada data ahli yang direkod lagi)");
        }

        return await ctx.reply(ctx.format.info(parts.join("\n").trim()));
    }
};
