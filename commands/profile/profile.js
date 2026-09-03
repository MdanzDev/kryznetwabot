module.exports = {
    name: "profile",
    aliases: ["me", "prof", "profil"],
    category: "profile",
    code: async (ctx) => {
        const users = ctx.db.users.getAll();
        const userDb = ctx.db.user;
        const leaderboardData = users.map(user => ({
            id: user.id,
            level: user.level || 0,
            winGame: user.winGame || 0
        })).sort((a, b) => b.winGame - a.winGame || b.level - a.level);

        let status;
        if (ctx.sender.isOwner()) {
            status = "Owner ♡";
        } else if (userDb?.premium) {
            status = userDb?.premiumExpiration
                ? `Premium ♡ (${ctx.format.convertMsToDuration(
                    userDb.premiumExpiration - Date.now(),
                    ["hari", "jam"]
                )} tersisa)`
                : "Premium ♡ (Selamanya)";
        } else {
            status = "Freemium";
        }

        const rank = leaderboardData.findIndex(user => ctx.helper.areJidsSameUser(user.id, ctx.sender.lid)) + 1;

        const text =
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑼𝒔𝒆𝒓 𝑷𝒓𝒐𝒇𝒊𝒍𝒆  ♡⊹˚₊\n" +
            `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა  @${ctx.getId(ctx.sender.lid)}\n` +
            "│ (｡･ω･｡)ﾉ♡ Info akun kamu!\n" +
            "╰───────────────୨୧\n\n" +
            "╭┈┈┈┈┈┈┈┈୨୧\n" +
            "┊ ✦ 𝑷𝒓𝒐𝒇𝒊𝒍𝒆 ୨୧\n" +
            `┊ ♡ Nama      › ${ctx.sender.pushName || "Unknown"}\n` +
            `┊ ♡ Status    › ${status}\n` +
            `┊ ♡ Level     › ${userDb?.level || 0} (${userDb?.xp || 0}/100 XP)\n` +
            `┊ ♡ Coins     › ${ctx.sender.isOwner() || userDb?.premium ? "Unlimited ♡" : (userDb?.coin || 0)}\n` +
            `┊ ♡ Menang    › ${userDb?.winGame || 0} game\n` +
            `┊ ♡ Peringkat › #${rank} dari ${users.length} users\n` +
            "╰┈┈┈┈┈┈┈┈୨୧\n\n" +
            "╭───────────────୨୧\n" +
            "│ (｡•̀ᴗ-)✧ Semangat terus mainnya ya! ♡\n" +
            "╰───────────────୨୧";

        await ctx.reply({
            text,
            mentions: [ctx.sender.lid],
            buttons: [
                {
                    text: "♡ Klaim Hadiah",
                    id: `${ctx.used.prefix}claim daily`
                },
                {
                    text: "୨୧ Leaderboard",
                    id: `${ctx.used.prefix}leaderboard`
                },
                {
                    text: "♡ Menu Utama",
                    id: `${ctx.used.prefix}menu`
                }
            ]
        });
    }
};