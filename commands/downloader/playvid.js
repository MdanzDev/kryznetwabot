module.exports = {
    name: "playvid",
    aliases: ["playvideo", "pv", "playmp4"],
    category: "downloader",
    permissions: {
        coin: 15
    },
    code: async (ctx) => {
        const flag = ctx.flag({
            index: {
                type: "string",
                short: "i",
                default: "0"
            },
            document: {
                type: "boolean",
                short: "d",
                default: false
            }
        });
        const input = flag.input;
        if (!input)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "crossing fields - lisa -i 1 -d")}\n` +
                ctx.format.generatesFlagInfo({
                    "-i <number>": "Pilihan pada data indeks (default: 0)",
                    "-d": "Kirim sebagai dokumen"
                })
            );

        try {
            const searchIndex = parseInt(flag.index, 10);
            // Search YouTube for the video
            const searchApiUrl = ctx.api.createUrl("nexray", "/search/youtube", {
                q: input
            });
            const searchResults = (await ctx.request.get(searchApiUrl)).data.result;
            const searchResult = searchResults[searchIndex];
            if (!searchResult)
                return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Hasil tidak ditemukan untuk "${input}"`));

            await ctx.reply(
                "╭───────────────୨୧\n" +
                "│  ₊˚⊹♡  𝑵𝒐𝒘 𝑷𝒍𝒂𝒚𝒊𝒏𝒈  ♡⊹˚₊\n" +
                "│ (｡･ω･｡)ﾉ Sedang menyiapkan video untukmu~ ✧\n" +
                "╰───────────────୨୧\n\n" +
                "╭┈┈┈┈┈┈┈┈୨୧\n" +
                "┊ ✦ 𝑰𝒏𝒇𝒐 𝑽𝒊𝒅𝒆𝒐 ୨୧\n" +
                `┊ ♡ Judul   › ${searchResult.title}\n` +
                `┊ ♡ Channel › ${searchResult.channel}\n` +
                `┊ ❖ Sumber  › YOUTUBE ♡\n` +
                "╰┈┈┈┈┈┈┈┈୨୧"
            );

            // Download as MP4 via faaa endpoint
            const downloadApiUrl = ctx.api.createUrl("faaa", "/faa/ytmp4", {
                url: searchResult.url
            });
            const downloadResult = (await ctx.request.get(downloadApiUrl)).data.result;

            if (!downloadResult?.download_url)
                return await ctx.reply(ctx.format.info("(╥﹏╥) Gagal mengunduh video. Coba lagi ya~"));

            if (config.system.autoTypingOnCmd) await ctx.simulateTyping();

            const content = flag.document ? {
                document: {
                    url: downloadResult.download_url
                },
                fileName: `${(searchResult.title || "video").replace(/[^\w\s-]/g, "").trim().slice(0, 60)}.mp4`,
                mimetype: "video/mp4",
                caption: `❖ ${searchResult.title}`
            } : {
                video: {
                    url: downloadResult.download_url
                },
                caption: `❖ ${searchResult.title}\n♡ Channel: ${searchResult.channel}`
            };
            await ctx.reply(content);
        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
};
