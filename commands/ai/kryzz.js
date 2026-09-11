const kryzai = require("../../lib/kryzai.js");

module.exports = {
    name: "kryzz",
    aliases: ["kryz"],
    category: "ai",
    code: async (ctx) => {
        const input = ctx.text || ctx.quoted?.body;
        if (!input)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                ctx.format.generateCmdExample(ctx.used, "download video tiktok https://vt.tiktok.com/xxxx") + "\n" +
                ctx.format.generateNotes([
                    "Kamu juga bisa langsung chat tanpa prefix: kryzz <pertanyaan kamu>",
                    "Kryzz bisa jalanin perintah bot lain (downloader, search, dll) dan perintah terminal (khusus owner)."
                ])
            );

        await kryzai.handleKryzz(ctx.bot, ctx, input);
    }
};
