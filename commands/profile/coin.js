module.exports = {
    name: "coin",
    aliases: ["koin"],
    category: "profile",
    code: async (ctx) => {
        const isUnlimited = ctx.sender.isOwner() || ctx.db.user?.premium;
        const amount = isUnlimited ? "Unlimited ♡" : `${ctx.db.user?.coin || 0} koin`;

        const text =
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑪𝒐𝒊𝒏 𝑰𝒏𝒇𝒐  ♡⊹˚₊\n" +
            `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა Koin kamu saat ini:\n` +
            `│ ✦ ${amount}\n` +
            "│ (｡•̀ᴗ-)✧ Gunakan untuk bermain game ya! ♡\n" +
            "╰───────────────୨୧";

        await ctx.reply({
            text,
            buttons: [
                {
                    text: "♡ Klaim Daily",
                    id: `${ctx.used.prefix}claim daily`
                },
                {
                    text: "୨୧ Profile Saya",
                    id: `${ctx.used.prefix}profile`
                },
                {
                    text: "♡ Main Game",
                    id: `${ctx.used.prefix}menu game`
                }
            ]
        });
    }
};