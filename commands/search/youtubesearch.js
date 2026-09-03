module.exports = {
    name: "youtubesearch",
    aliases: ["youtube", "youtubes", "yt", "yts", "ytsearch"],
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
                text: ctx.format.info("(｡･ω･｡) Input berupa tautan YouTube! Pilih format download di bawah ya~ ♡"),
                buttons: [{
                    text: "♡ Download Audio",
                    id: `${ctx.used.prefix}youtubeaudio ${input}`
                }, {
                    text: "୨୧ Download Video",
                    id: `${ctx.used.prefix}youtubevideo ${input}`
                }]
            });

        try {
            const apiUrl = ctx.api.createUrl("nexray", "/search/youtube", {
                q: input
            });
            const result = (await ctx.request.get(apiUrl)).data.result;
            if (!result?.length) return await ctx.reply(ctx.format.info(config.msg.notFound));

            let text = "╭───────────────୨୧\n" +
                       "│  ₊˚⊹♡  𝒀𝒐𝒖𝑻𝒖𝒃𝒆 𝑺𝒆𝒂𝒓𝒄𝒉  ♡⊹˚₊\n" +
                       `│ (｡･ω･｡) Hasil pencarian: ${ctx.format.inlineCode(input)}\n` +
                       "╰───────────────୨୧\n\n";

            result.slice(0, 5).forEach((res, i) => {
                text += "╭┈┈┈┈┈┈┈┈୨୧\n" +
                        `┊ ✦ Video #${i + 1} ୨୧\n` +
                        `┊ ♡ Judul   › ${res.title}\n` +
                        `┊ ♡ Channel › ${res.channel}\n` +
                        `┊ ❖ URL     › ${res.url}\n` +
                        "╰┈┈┈┈┈┈┈┈୨୧\n\n";
            });

            text += "╭───────────────୨୧\n" +
                    `│ (｡•̀ᴗ-)✧ Ketik ${ctx.format.inlineCode(`${ctx.used.prefix}play <judul>`)} untuk memutar audio! ♡\n` +
                    "╰───────────────୨୧";

            await ctx.reply(text);
        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
};