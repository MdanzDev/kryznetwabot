module.exports = {
    name: "level",
    aliases: ["lvl"],
    category: "profile",
    code: async (ctx) => {
        const userDb = ctx.db.user;
        const text =
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑳𝒆𝒗𝒆𝒍 𝑰𝒏𝒇𝒐  ♡⊹˚₊\n" +
            `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა Level kamu saat ini:\n` +
            `│ ✦ Level ${userDb?.level || 0}\n` +
            `│ ♡ Progress › ${userDb?.xp || 0}/100 XP\n` +
            "│ (｡•̀ᴗ-)✧ Tingkatkan dengan sering chat & main game! ♡\n" +
            "╰───────────────୨୧";

        await ctx.reply({
            text,
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