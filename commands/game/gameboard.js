// gameboard.js — leaderboard across game sessions.
//
// The 8 games were stateless: no streaks, no history, nothing survived the
// message. Results are now recorded once per invocation in lib/handler.js (the
// single choke point) so this command reads them back without any game file
// needing to know it exists.
"use strict";

const digits = (j = "") => String(j).split("@")[0].split(":")[0].replace(/\D/g, "");

function chatIdFor(ctx) {
    const tg = ctx.bot?.waAlya?.tg;
    if (ctx.sender.isOwner()) return String(tg?.config?.ownerIds?.[0] || "wa_owner");
    if (ctx.isGroup()) return "wag_" + ctx.id;
    return "wa_" + (digits(ctx.sender.jid) || digits(ctx.sender.lid) || "unknown");
}

module.exports = {
    name: "gameboard",
    aliases: ["papanmarkah", "topgame"],
    category: "game",
    description: "Papan markah game — siapa paling banyak main",
    cooldown: 5,
    code: async (ctx) => {
        const store = ctx.bot?.waAlya?.tg?.store;
        if (!store) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Store tak aktif."));

        const chatId = chatIdFor(ctx);
        const p = ctx.used?.prefix || ".";
        const arg = String(ctx.text || "").trim().toLowerCase();

        // .gameboard <nama game>  |  .gameboard  (all games)
        const game = arg || null;

        let rows = [];
        try {
            rows = store.gameBoard(chatId, { game, limit: 10, days: 30 }) || [];
        } catch (e) {
            return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Gagal baca markah: ${e.message}`));
        }

        if (!rows.length) {
            return await ctx.reply(ctx.format.info(
                `(｡･ω･｡) Belum ada markah${game ? ` untuk ${game}` : ""} dalam chat ni (30 hari).\n\n` +
                `♡ Main dulu: ${p}coinflip, ${p}dice, ${p}tebakkata…`
            ));
        }

        const lines = rows.map((r, i) => {
            const medal = ["🥇", "🥈", "🥉"][i] || "♡";
            return `${medal} ${String(r.user_id).slice(-4).padStart(4, "·")} — ${r.played} main`;
        });

        return await ctx.reply(ctx.format.info(
            `❖ *Papan markah*${game ? ` — ${game}` : ""} (30 hari)\n\n` +
            lines.join("\n") +
            `\n\n♡ ${p}gameboard <nama game> untuk satu game`
        ));
    }
};
