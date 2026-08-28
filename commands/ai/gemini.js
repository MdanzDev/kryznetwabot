module.exports = {
    name: "gemini",
    category: "ai",
    permissions: {
        coin: 10
    },
    code: async (ctx) => {
        const input = ctx.text || ctx.quoted?.body;
        if (!input)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "apa itu evangelion?")}\n` +
                ctx.format.generateNotes([
                    `Ketik ${ctx.format.inlineCode(`${ctx.used.prefix + ctx.used.command} reset`)} untuk mereset riwayat percakapan.`
                ])
            );

        const senderDb = ctx.db.user;
        if (input.toLowerCase() === "reset") {
            (senderDb.sessionId ||= {}).gemini = "";
            senderDb.save();
            return await ctx.reply(ctx.format.info("Riwayat percakapan berhasil direset!"));
        }

        try {
            const apiUrl = ctx.api.createUrl("ammaricano", "/api/ai/v2/gemini", {
                ask: input,
                session: senderDb.sessionId.gemini || ""
            });
            const result = (await ctx.request.get(apiUrl)).data.result;
            if (!senderDb.sessionId?.gemini) {
                (senderDb.sessionId ||= {}).gemini = result.sessionId;
                senderDb.save();
            }
            await ctx.reply({
                richResponse: [{
                    text: result.text
                }]
            });
        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
};