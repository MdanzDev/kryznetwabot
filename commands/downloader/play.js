module.exports = {
    name: "play",
    category: "downloader",
    permissions: {
        coin: 10
    },
    code: async (ctx) => {
        const flag = ctx.flag({
            index: {
                type: "string",
                short: "i",
                default: "0"
            },
            source: {
                type: "string",
                short: "s",
                default: "youtube"
            }
        });
        const input = flag.input;
        if (!input)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "one last kiss - hikaru utada -i 8 -s spotify")}\n` +
                ctx.format.generatesFlagInfo({
                    "-i <number>": "Pilihan pada data indeks",
                    "-s <text>": "Sumber untuk memutar lagu (tersedia: spotify, youtube | default: youtube)"
                })
            );

        try {
            const searchIndex = parseInt(flag.index, 10);
            const source = flag.source;
            let searchResult = "";
            let downloadResult = "";

            if (source === "spotify") {
                const searchApiUrl = ctx.api.createUrl("nexray", "/search/spotify", {
                    q: input
                });
                searchResult = (await ctx.request.get(searchApiUrl)).data.result[searchIndex];
                await ctx.reply(
                    "╭───────────────୨୧\n" +
                    "│  ₊˚⊹♡  𝑵𝒐𝒘 𝑷𝒍𝒂𝒚𝒊𝒏𝒈  ♡⊹˚₊\n" +
                    "│ (｡･ω･｡)ﾉ Sedang menyiapkan lagu untukmu~ ✧\n" +
                    "╰───────────────୨୧\n\n" +
                    "╭┈┈┈┈┈┈┈┈୨୧\n" +
                    "┊ ✦ 𝑰𝒏𝒇𝒐 𝑳𝒂𝒈𝒖 ୨୧\n" +
                    `┊ ♡ Judul  › ${searchResult.title}\n` +
                    `┊ ♡ Artis  › ${searchResult.artist}\n` +
                    "┊ ❖ Sumber › SPOTIFY ♡\n" +
                    "╰┈┈┈┈┈┈┈┈୨୧"
                );
                const downloadApiUrl = ctx.api.createUrl("nexray", "/downloader/spotify", {
                    url: searchResult.url
                });
                downloadResult = (await ctx.request.get(downloadApiUrl)).data.result.url;
            } else {
                const searchApiUrl = ctx.api.createUrl("nexray", "/search/youtube", {
                    q: input
                });
                searchResult = (await ctx.request.get(searchApiUrl)).data.result[searchIndex];
                await ctx.reply(
                    "╭───────────────୨୧\n" +
                    "│  ₊˚⊹♡  𝑵𝒐𝒘 𝑷𝒍𝒂𝒚𝒊𝒏𝒈  ♡⊹˚₊\n" +
                    "│ (｡･ω･｡)ﾉ Sedang menyiapkan lagu untukmu~ ✧\n" +
                    "╰───────────────୨୧\n\n" +
                    "╭┈┈┈┈┈┈┈┈୨୧\n" +
                    "┊ ✦ 𝑰𝒏𝒇𝒐 𝑳𝒂𝒈𝒖 ୨୧\n" +
                    `┊ ♡ Judul   › ${searchResult.title}\n` +
                    `┊ ♡ Channel › ${searchResult.channel}\n` +
                    "┊ ❖ Sumber  › YOUTUBE ♡\n" +
                    "╰┈┈┈┈┈┈┈┈୨୧"
                );
                const downloadApiUrl = ctx.api.createUrl("nexray", "/downloader/savetube", {
                    url: searchResult.url,
                    quality: "mp3"
                });
                downloadResult = (await ctx.request.get(downloadApiUrl)).data.result.url;
            }

            if (config.system.autoTypingOnCmd) await ctx.simulateTyping()
            await ctx.reply({
                audio: {
                    url: downloadResult
                },
                mimetype: "audio/mpeg"
            });
        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
};