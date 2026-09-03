module.exports = {
    name: "xp",
    aliases: ["exp", "experience"],
    category: "profile",
    code: async (ctx) => {
        const userDb = ctx.db.user;
        const text =
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑿𝑷 𝑰𝒏𝒇𝒐  ♡⊹˚₊\n" +
            `│ ૮ ˶ᵔ ᵕ ᵔ˶ Parse ა XP kamu saat ini:\n` +
            `│ ✦ ${userDb?.xp || 0} / 100 XP\n` +
            `│ ♡ Berada di › Level ${userDb?.level || 0}\n` +
            "│ (｡•̀ᴗ-)✧ Semakin aktif, semakin tinggi levelmu! ♡\n" +
            "╰───────────────୨୧";

        await ctx.reply({
            text: text.replace("Parse ", ""),
            buttons: [
                {
                    text: "♡ Profile Saya",
                    id: `${ctx.used.prefix}profile`
                },
                {
                    text: "୨୧ Leaderboard",
                    id: `${ctx.used.prefix}leaderboard`
                }
            ]
        });
    }
};