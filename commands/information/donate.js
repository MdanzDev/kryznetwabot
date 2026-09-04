module.exports = {
    name: "donate",
    aliases: ["donasi", "support"],
    category: "information",

    code: async (ctx) => {
        try {
            const botText = ctx.db.bot.text || {};

            const qrisLink =
                "https://files.catbox.moe/io9pcf.jpg";

            const customText = botText?.donate;

            const text = customText
                ? customText
                    .replace(/%tag%/g, `@${ctx.getId(ctx.sender.lid)}`)
                    .replace(/%name%/g, config.bot.name)
                    .replace(/%prefix%/g, ctx.used.prefix)
                    .replace(/%command%/g, ctx.used.command)
                    .replace(/%footer%/g, config.msg.footer)
                    .replace(/%readmore%/g, "\u200E".repeat(4001))
                : "╭───────────────୨୧\n" +
                  "│  ₊˚⊹♡  𝑺𝒖𝒑𝒑𝒐𝒓𝒕 𝑫𝒆𝒗  ♡⊹˚₊\n" +
                  "│  (｡･ω･｡)ﾉ♡ Thank you for considering!\n" +
                  "╰───────────────୨୧\n\n" +
                  "╭┈┈┈┈┈┈┈┈୨୧\n" +
                  "┊ ✦ 𝑫𝒐𝒏𝒂𝒔𝒊 ୨୧\n" +
                  "┊\n" +
                  "┊ ❖ 60137345871\n" +
                  "┊    (TNG E-Wallet & ShopeePay)\n" +
                  "┊\n" +
                  "┊ ❖ 64685895149199\n" +
                  "┊    (DuitNow || ShopeePay)\n" +
                  "┊\n" +
                  "┊ ❖ 131771767889\n" +
                  "┊    (DuitNow || TNG E-Wallet)\n" +
                  "┊\n" +
                  "┊ ❖ https://founder.kryz-net.space\n" +
                  "┊    (Portfolio)\n" +
                  "╰┈┈┈┈┈┈┈┈୨୧\n\n" +
                  "╭───────────────୨୧\n" +
                  "│ ♡ Setiap dukungan kamu berarti\n" +
                  "│ banget buat developer kecil ini~\n" +
                  "│ (｡•̀ᴗ-)✧ Makasih banyak ya! ♡\n" +
                  "╰───────────────୨୧";

            await ctx.reply({
                image: {
                    url: qrisLink
                },
                caption: text
            });

        } catch (error) {
            console.error("[DONATE ERROR]", error);
            await ctx.helper.handleError(ctx, error);
        }
    }
};
