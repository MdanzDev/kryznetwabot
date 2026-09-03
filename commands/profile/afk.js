module.exports = {
    name: "afk",
    category: "profile",
    code: async (ctx) => {
        const input = ctx.text;
        const senderDb = ctx.db.user;
        senderDb.afk = {
            reason: input,
            timestamp: Date.now()
        };
        senderDb.save();

        const text =
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑨𝑭𝑲 𝑴𝒐𝒅𝒆  ♡⊹˚₊\n" +
            `│ (｡･ω･｡) Kamu sekarang masuk mode AFK~\n` +
            `│ ♡ Alasan › ${input ? ctx.format.inlineCode(input) : "Tanpa alasan"}\n` +
            "│ (｡•̀ᴗ-)✧ Kirim pesan apapun untuk selesai AFK! ♡\n" +
            "╰───────────────୨୧";

        await ctx.reply(text);
    }
};