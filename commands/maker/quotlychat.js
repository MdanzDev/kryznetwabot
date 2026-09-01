const moment = require("moment-timezone");

module.exports = {
    name: "quotlychat",
    aliases: ["qc", "quotly"],
    category: "maker",
    permissions: {
        coin: 10
    },
    code: async (ctx) => {
        const input = ctx.text || ctx.quoted?.body;
        if (!input)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                ctx.format.generateCmdExample(ctx.used, "get in the fucking robot, shinji!")
            );
        if (input.length > 1000) return await ctx.reply(ctx.format.info("Maksimal 1000 karakter!"));

        try {
            const isQuoted = !ctx.text && ctx.quoted;
            const profilePictureUrl = await ctx.core.profilePictureUrl(isQuoted ? ctx.quoted?.sender : ctx.sender.lid).catch(() => "https://placehold.net/avatar.png");
            const apiUrl = ctx.api.createUrl("azbry", "/api/maker/qwa", {
                sender_name: isQuoted ? ctx.quoted?.pushName : ctx.sender.pushName,
                sender_avatar: profilePictureUrl,
                message: input,
                time: moment.tz(config.system.timeZone).format("HH:mm"),
                ...(!isQuoted && ctx.quoted && {
                    "quoted.name": ctx.quoted.pushName,
                    "quoted.message": ctx.quoted.body
                })
            });
            const result = (await ctx.request.post(apiUrl, null, {
                responseType: "arraybuffer"
            })).data;
            await ctx.reply({
                sticker: result
            }, {
                pack: config.sticker.packname,
                author: config.sticker.author
            });
        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
};