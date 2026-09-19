module.exports = {
    name: "resetai",
    aliases: ["clearai", "resetbot"],
    category: "group",
    code: async (ctx) => {
        const isGroup = ctx.isGroup();
        const senderId = ctx.getId(ctx.sender.jid);
        const isOwner = ctx.sender.isOwner();
        const isAdmin = isGroup ? await ctx.group().isSenderAdmin() : false;

        if (!isOwner && !isAdmin) {
            return await ctx.reply(ctx.format.info("(｡•ˇ‸ˇ•｡) Admin/owner je boleh reset AI session."));
        }

        // Clear ALL histories for this chat (group: all per-user sessions; private: just this chat)
        const bot = ctx.bot;
        if (bot.waAlya && bot.waAlya.tg) {
            const histories = bot.waAlya.tg.histories;
            const prefix = isGroup ? `wag_${ctx.id}` : `wa_${senderId}`;
            let cleared = 0;
            for (const key of histories.keys()) {
                if (key.startsWith(prefix)) { histories.delete(key); cleared++; }
            }
            bot.waAlya.tg.state.set("histories", Object.fromEntries(histories));
        }

        return await ctx.reply(
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  AI Session Reset  ♡⊹˚₊\n" +
            "╰───────────────୨୧\n\n" +
            "(｡･ω･｡)✧ Memory AI dah dibersihkan untuk chat ni.\n" +
            "Sekarang Alya akan mula fresh — macam baru kenal."
        );
    }
};
