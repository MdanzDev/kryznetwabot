module.exports = {
    name: "botgroup",
    aliases: ["botgc", "gcbot"],
    category: "information",
    code: async (ctx) => {
        const text =
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑶𝒇𝒇𝒊𝒄𝒊𝒂𝒍 𝑮𝒓𝒐𝒖𝒑  ♡⊹˚₊\n" +
            `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა Gabung ke grup resmi kami!\n` +
            `│ ✦ Link › ${config.bot.groupLink}\n` +
            "│ (｡•̀ᴗ-)✧ Dapatkan info update & teman baru! ♡\n" +
            "╰───────────────୨୧";

        await ctx.reply({
            text,
            buttons: [
                {
                    text: "♡ Menu Utama",
                    id: `${ctx.used.prefix}menu`
                },
                {
                    text: "୨୧ Hubungi Owner",
                    id: `${ctx.used.prefix}owner`
                }
            ]
        });
    }
};