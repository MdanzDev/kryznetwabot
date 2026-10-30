// quote.js — pull a random line out of this group's history.
//
// Reads the durable chat_lines archive (populated by WaAlya._record), not the
// in-memory ContextStore, so a quote still works right after a deploy — the
// whole point of a "remember this?" feature.
//
// Groups only: in a DM the archive would just be the user's own messages back
// to them, which is not a quote, it's an echo.
"use strict";

const clean = (s) => String(s || "")
    .replace(/\s+/g, " ")
    .trim();

module.exports = {
    name: "quote",
    aliases: ["randomquote", "throwback"],
    category: "tool",
    description: "Ambil satu mesej rawak dari sejarah grup ni",
    cooldown: 5,
    code: async (ctx) => {
        if (!ctx.isGroup())
            return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Quote khusus dalam grup — dalam DM tak best."));

        const store = ctx.bot?.waAlya?.tg?.store;
        if (!store) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Store tak aktif."));

        const chatId = "wag_" + ctx.id;

        let total = 0;
        try {
            total = store.countChatLines(chatId);
        } catch (e) {
            return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Gagal baca sejarah: ${e.message}`));
        }

        if (total < 10) {
            return await ctx.reply(ctx.format.info(
                `(｡･ω･｡) Baru ada ${total} mesej direkod dalam grup ni.\n` +
                `♡ Kena ada sekurang-kurangnya 10 sebelum aku boleh quote.`
            ));
        }

        // Retry a few times: the random row may be a command, a link, or noise.
        let pick = null;
        for (let i = 0; i < 5; i++) {
            let row;
            try {
                // minLen 20 skips "ok", "haha", stickers-as-text.
                row = store.randomChatLine(chatId, { minLen: 20 });
            } catch (e) {
                return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Gagal baca sejarah: ${e.message}`));
            }
            if (!row) break;
            const text = clean(row.text);
            // Skip commands and pure links — they read as spam, not memory.
            if (/^[.\/!#]/.test(text)) continue;
            if (/^https?:\/\/\S+$/.test(text)) continue;
            pick = { text, sender: row.sender_name || row.sender_id || "seseorang", at: row.created_at };
            break;
        }

        if (!pick) {
            return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Tak jumpa mesej yang sesuai untuk diquote."));
        }

        const when = new Date(pick.at).toLocaleDateString("en-MY", {
            timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", year: "numeric"
        });

        // WhatsApp quotes a real message; we are quoting text we stored, so this
        // renders as a styled block instead of a fake reply-quote.
        return await ctx.reply(ctx.format.info(
            `❖ *Throwback* — ${when}\n\n` +
            `> ${pick.text.slice(0, 400)}\n\n` +
            `— ${String(pick.sender).slice(0, 30)}`
        ));
    }
};
