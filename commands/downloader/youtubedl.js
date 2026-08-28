module.exports = [{
    name: "youtubeaudio",
    aliases: ["yta", "ytaudio", "ytmp3"],
    category: "downloader",
    permissions: {
        coin: 10
    },
    code: async (ctx) => {
        const flag = ctx.flag({
            document: {
                type: "boolean",
                short: "d",
                default: false
            }
        });
        const url = flag.input || ctx.helper.extractUrlFromText(ctx.quoted?.body);
        if (!url)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "https://www.youtube.com/watch?v=0Uhh62MUEic -d")}\n` +
                ctx.format.generatesFlagInfo({
                    "-d": "Kirim sebagai dokumen"
                })
            );
        if (!ctx.helper.isUrl(url)) return await ctx.reply(ctx.format.info(config.msg.invalidUrl));

        try {
            const apiUrl = ctx.api.createUrl("nexray", "/downloader/savetube", {
                url,
                quality: "mp3"
            });
            const result = (await ctx.request.get(apiUrl)).data.result;
            const content = flag.document ? {
                document: {
                    url: result.url
                },
                fileName: `${result.title}.mp3`,
                mimetype: "audio/mpeg",
                caption: `❖ ${ctx.format.bold("URL")}: ${url}`
            } : {
                audio: {
                    url: result.url
                },
                mimetype: "audio/mpeg"
            };
            await ctx.reply(content);
        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
}, {
    name: "youtubevideo",
    aliases: ["ytmp4", "ytv", "ytvideo"],
    category: "downloader",
    permissions: {
        coin: 10
    },
    code: async (ctx) => {
        const flag = ctx.flag({
            document: {
                type: "boolean",
                short: "d",
                default: false
            }
        });
        const url = flag.input || ctx.helper.extractUrlFromText(ctx.quoted?.body);
        if (!url)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "https://www.youtube.com/watch?v=0Uhh62MUEic -d")}\n` +
                ctx.format.generatesFlagInfo({
                    "-d": "Kirim sebagai dokumen"
                })
            );
        if (!ctx.helper.isUrl(url)) return await ctx.reply(ctx.format.info(config.msg.invalidUrl));

        try {
            const apiUrl = ctx.api.createUrl("faaa", "/faa/ytmp4", {
                url
            });
            const result = (await ctx.request.get(apiUrl)).data.result.download_url;
            const content = flag.document ? {
                document: {
                    url: result
                },
                fileName: `${Math.random().toString(36).substring(2, 9)}.mp4`,
                mimetype: "video/mp4",
                caption: `❖ ${ctx.format.bold("URL")}: ${url}`
            } : {
                video: {
                    url: result
                },
                caption: `❖ ${ctx.format.bold("URL")}: ${url}`
            };
            await ctx.reply(content);
        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
}];