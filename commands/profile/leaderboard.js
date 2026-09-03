module.exports = {
    name: "leaderboard",
    aliases: ["lb", "peringkat"],
    category: "profile",
    code: async (ctx) => {
        const users = ctx.db.users.getAll();
        const senderLid = ctx.sender.lid;
        const senderId = ctx.getId(senderLid);

        const leaderboardData = users.map(user => ({
            id: user.id,
            pushName: user.pushName,
            level: user.level || 0,
            winGame: user.winGame || 0
        })).sort((a, b) => b.winGame - a.winGame || b.level - a.level);

        const userRank = leaderboardData.findIndex(user => ctx.helper.areJidsSameUser(user.id, senderLid)) + 1;
        const topUsers = leaderboardData.slice(0, 10);
        const mentions = [];

        const medals = ["🥇", "🥈", "🥉"];

        let itemsText = "";
        topUsers.forEach((user, i) => {
            const isSelf = ctx.helper.areJidsSameUser(user.id, senderLid);
            const displayUser = isSelf ? `@${senderId}` : (user.pushName || ctx.getId(user.id));
            if (isSelf) mentions.push(senderLid);
            const badge = medals[i] || `✧ #${i + 1}`;
            itemsText += `┊ ${badge} ${ctx.format.bold(displayUser)}\n` +
                         `┊    ♡ Level › ${user.level} (${user.winGame} Win)\n`;
            if (i < topUsers.length - 1) itemsText += "┊\n";
        });

        let rankText = "";
        if (userRank > 10) {
            const userStats = leaderboardData[userRank - 1];
            mentions.push(senderLid);
            rankText = "\n╭┈┈┈┈┈┈┈┈୨୧\n" +
                       "┊ ✦ 𝑷𝒐𝒔𝒊𝒔𝒊 𝑲𝒂𝒎𝒖 ୨୧\n" +
                       `┊ ✧ #${userRank} @${senderId}\n` +
                       `┊    ♡ Level › ${userStats.level} (${userStats.winGame} Win)\n` +
                       "╰┈┈┈┈┈┈┈┈୨୧\n";
        }

        const text =
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑳𝒆𝒂𝒅𝒆𝒓𝒃𝒐𝒂𝒓𝒅  ♡⊹˚₊\n" +
            "│  ૮ ˶ᵔ ᵕ ᵔ˶ ა Top 10 Pemain Terbaik!\n" +
            "╰───────────────୨୧\n\n" +
            "╭┈┈┈┈┈┈┈┈୨୧\n" +
            "┊ ✦ 𝑷𝒆𝒓𝒊𝒏𝒈𝒌𝒂𝒕 ୨୧\n" +
            itemsText +
            "╰┈┈┈┈┈┈┈┈୨୧" +
            rankText + "\n" +
            "╭───────────────୨୧\n" +
            "│ (｡•̀ᴗ-)✧ Main terus & raih posisi puncak! ♡\n" +
            "╰───────────────୨୧";

        await ctx.reply({
            text: text.trim(),
            mentions,
            buttons: [
                {
                    text: "♡ Profile Saya",
                    id: `${ctx.used.prefix}profile`
                },
                {
                    text: "୨୧ Main Game",
                    id: `${ctx.used.prefix}menu game`
                }
            ]
        });
    }
};