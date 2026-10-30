// whois.js — one member's full picture, for group admins.
//
// `.listwarning` shows everyone with warnings; admins kept asking the different
// question: "tell me about THIS person". Everything needed already exists —
// the authoritative roster from group metadata, tracked activity, warnings, and
// the global user record. buildRanking() is reused so the numbers here can never
// disagree with .topsider / .digest / .kickidle.
"use strict";
const { buildRanking, ageLabel } = require("../../lib/group-rank");

const digits = (j = "") => String(j).split("@")[0].split(":")[0].replace(/\D/g, "");

// Resolve the target: a mention, a quoted message, an @number, or bare digits.
function resolveTarget(ctx) {
    const mentioned = ctx.msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length) return mentioned[0];

    const q = ctx.quoted?.sender || ctx.quoted?.senderId;
    if (q) return q;

    const arg = String(ctx.args?.[0] || "").trim();
    if (arg) {
        const d = digits(arg);
        if (d) return `${d}@s.whatsapp.net`;
    }
    return null;
}

module.exports = {
    name: "whois",
    aliases: ["memberinfo", "cekmember"],
    category: "group",
    permissions: { group: true },
    description: "Info lengkap satu ahli grup",
    cooldown: 3,
    code: async (ctx) => {
        if (!ctx.isGroup()) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Khusus dalam grup."));

        const p = ctx.used?.prefix || ".";
        const target = resolveTarget(ctx);
        if (!target)
            return await ctx.reply(ctx.format.info(
                `(｡•́︿•̀｡) Nak tengok siapa?\n\n` +
                `♡ Tag: ${p}whois @kawan\n` +
                `♡ Reply mesej dia: ${p}whois\n` +
                `♡ Atau nombor: ${p}whois 60123456789`
            ));

        let rows;
        try {
            rows = (await buildRanking(ctx)) || [];
        } catch (e) {
            return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Gagal baca senarai ahli: ${e.message}`));
        }

        const same = (a, b) => digits(a) === digits(b);
        const row = rows.find((r) => same(r.id, target));
        if (!row)
            return await ctx.reply(ctx.format.info(
                "(｡•́︿•̀｡) Orang tu bukan ahli grup ni (atau dah keluar)."
            ));

        // Global user record (coins, level, premium, banned).
        const user = ctx.db?.core?.getCollection
            ? ctx.db.core.getCollection("users")
            : null;
        const rec = user ? ctx.helper.getDb(user, target) : null;

        const warnings = (ctx.db.group?.warnings || [])
            .find((w) => same(w.id, target));

        const lines = [`❖ *Who is* — ${row.name}`];
        lines.push(`♡ Nombor   › ${digits(row.id)}`);
        if (row.isGroupOwner) lines.push(`♡ Peranan  › 👑 Owner grup`);
        else if (row.isAdmin) lines.push(`♡ Peranan  › 🛡️ Admin`);
        else lines.push(`♡ Peranan  › Ahli biasa`);

        lines.push(`♡ Mesej    › ${row.sent || 0}`);
        if (row.firstSeen) {
            lines.push(`♡ Mula     › ${new Date(row.firstSeen).toLocaleDateString("en-MY", {
                timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", year: "numeric"
            })} (${ageLabel(row.firstSeen)})`);
        } else {
            lines.push(`♡ Mula     › (tak direkod)`);
        }

        if (rec) {
            if (rec.premium) {
                const exp = rec.premiumExpiration
                    ? ` · tamat ${new Date(rec.premiumExpiration).toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}`
                    : "";
                lines.push(`♡ Premium  › ✅${exp}`);
            }
            if (rec.banned) lines.push(`♡ Status   › 🚫 BANNED`);
            lines.push(`♡ Level    › ${rec.level || 1} · ${rec.xp || 0} XP`);
            lines.push(`♡ Koin     › ${(rec.coin || 0).toLocaleString()}`);
            if (rec.winGame) lines.push(`♡ Menang   › ${rec.winGame}`);
        } else {
            lines.push(`♡ Profil   › (belum guna bot)`);
        }

        const maxW = ctx.db.group?.maxwarnings || 3;
        lines.push(`♡ Warning  › ${warnings ? `${warnings.count}/${maxW}` : `0/${maxW}`}`);

        if (row.isBot) lines.push(`\n♡ (ini aku sendiri 🐧)`);

        return await ctx.reply(ctx.format.info(lines.join("\n")));
    }
};
