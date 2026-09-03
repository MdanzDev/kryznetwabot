module.exports = {
    name: "spotifysearch",
    aliases: ["spotify", "spotifys"],
    category: "search",
    permissions: {
        coin: 10
    },
    code: async (ctx) => {
        const input = ctx.text;
        if (!input)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                ctx.format.generateCmdExample(ctx.used, "one last kiss - hikaru utada")
            );

        if (ctx.helper.isUrl(input))
            return await ctx.reply({
                text: ctx.format.info("(｡･ω･｡) Input berupa tautan Spotify! Klik tombol di bawah untuk download ya~ ♡"),
                buttons: [{
                    text: "♡ Download Lagu",
                    id: `${ctx.used.prefix}spotifydl ${input}`
                }]
            });

        try {
            const apiUrl = ctx.api.createUrl("nexray", "/search/spotify", {
                q: input
            });
            const result = (await ctx.request.get(apiUrl)).data.result;
            if (!result?.length) return await ctx.reply(ctx.format.info(config.msg.notFound));

            let text = "╭───────────────୨୧\n" +
                       "│  ₊˚⊹♡  𝑺𝒑𝒐𝒕𝒊𝒇𝒚 𝑺𝒆𝒂𝒓𝒄𝒉  ♡⊹˚₊\n" +
                       `│ (｡･ω･｡) Hasil pencarian: ${ctx.format.inlineCode(input)}\n` +
                       "╰───────────────୨୧\n\n";

            result.slice(0, 5).forEach((res, i) => {
                text += "╭┈┈┈┈┈┈┈┈୨୧\n" +
                        `┊ ✦ Lagu #${i + 1} ୨୧\n` +
                        `┊ ♡ Judul › ${res.title}\n` +
                        `┊ ♡ Artis › ${res.artist}\n` +
                        `┊ ❖ URL   › ${res.url}\n` +
                        "╰┈┈┈┈┈┈┈┈୨୧\n\n";
            });

            text += "╭───────────────୨୧\n" +
                    `│ (｡•̀ᴗ-)✧ Gunakan ${ctx.format.inlineCode(`${ctx.used.prefix}play`)} untuk memutar lagu ya! ♡\n` +
                    "╰───────────────୨୧";

            await ctx.reply(text);
        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
};