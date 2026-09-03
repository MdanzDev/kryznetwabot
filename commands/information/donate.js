module.exports = {
    name: "donate",
    aliases: ["donasi", "support"],
    category: "information",
    code: async (ctx) => {
        try {
            const botText = ctx.db.bot.text || {};
            const qrisLink = botText?.qris || "https://files.catbox.moe/theran.png";
            const customText = botText?.donate;
            const text = customText ? customText.replace(/%tag%/g, `@${ctx.getId(ctx.sender.lid)}`).replace(/%name%/g, config.bot.name).replace(/%prefix%/g, ctx.used.prefix).replace(/%command%/g, ctx.used.command).replace(/%footer%/g, config.msg.footer).replace(/%readmore%/g, "\u200E".repeat(4001)) :
                "❖ 60137345871 (TNG E-Wallet & ShopeePay)\n" +
                "❖ 64685895149199 (DuitNow || ShopeePay)\n" +
                "❖ 131771767889 (DuitNow || TNG E-Wallet)\n" +
                "❖ https://founder.kryz-net.space (PortFolio)";

            await ctx.reply({
                image: {
                    url: qrisLink
                },
                caption: text,
                mentions: [ctx.sender.lid]
            });
        } catch (error) {
            await ctx.helper.handleError(ctx, error);
        }
    }
};