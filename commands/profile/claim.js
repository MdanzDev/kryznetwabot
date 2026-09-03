const claimRewards = {
    daily: {
        reward: 100,
        cooldown: 24 * 60 * 60 * 1000,
        level: 1
    },
    weekly: {
        reward: 500,
        cooldown: 7 * 24 * 60 * 60 * 1000,
        level: 15
    },
    monthly: {
        reward: 2000,
        cooldown: 30 * 24 * 60 * 60 * 1000,
        level: 50
    },
    yearly: {
        reward: 10000,
        cooldown: 365 * 24 * 60 * 60 * 1000,
        level: 75
    }
};

module.exports = {
    name: "claim",
    aliases: ["bonus", "klaim"],
    category: "profile",
    code: async (ctx) => {
        const input = ctx.text;
        if (!input)
            return await ctx.reply({
                text: `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                    `${ctx.format.generateCmdExample(ctx.used, "daily")}\n` +
                    ctx.format.generateNotes([
                        `Ketik ${ctx.format.inlineCode(`${ctx.used.prefix + ctx.used.command} list`)} untuk melihat daftar hadiah.`
                    ]),
                buttons: [
                    {
                        text: "♡ Klaim Daily",
                        id: `${ctx.used.prefix}claim daily`
                    },
                    {
                        text: "୨୧ Daftar Hadiah",
                        id: `${ctx.used.prefix}claim list`
                    }
                ]
            });

        if (input.toLowerCase() === "list") {
            const listText = await ctx.list.get(ctx, "claim");
            return await ctx.reply({
                text: listText,
                buttons: [
                    {
                        text: "♡ Klaim Daily",
                        id: `${ctx.used.prefix}claim daily`
                    },
                    {
                        text: "୨୧ Cek Koin",
                        id: `${ctx.used.prefix}coin`
                    }
                ]
            });
        }

        const senderDb = ctx.db.user;
        const claim = claimRewards[input];
        const level = senderDb?.level || 0;

        if (!claim) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Pilihan hadiah tidak valid nih... Cek daftar hadiah ya~"));
        if (ctx.sender.isOwner() || senderDb?.premium) return await ctx.reply(ctx.format.info("૮ ˶ᵔ ᵕ ᵔ˶ ა Kamu sudah memiliki koin tak terbatas! Tidak perlu klaim lagi ya~ ♡"));
        if (level < claim.level) return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Kamu perlu mencapai Level ${claim.level} untuk mengklaim hadiah ini. Level kamu saat ini: ${level}~ ♡`));

        const currentTime = Date.now();
        const lastClaim = (senderDb?.lastClaim ?? {})[input] || 0;
        const remainingTime = claim.cooldown - (currentTime - lastClaim);
        if (remainingTime > 0) return await ctx.reply(ctx.format.info(`(｡•ˇ‸ˇ•｡) Kamu sudah mengklaim hadiah ${input}! Tunggu ${ctx.format.convertMsToDuration(remainingTime)} lagi ya~ ⏳`));

        try {
            senderDb.coin = (senderDb?.coin || 0) + claim.reward;
            (senderDb.lastClaim ||= {})[input] = currentTime;
            senderDb.save();
            await ctx.reply({
                text: "╭───────────────୨୧\n" +
                      "│  ₊˚⊹♡  𝑲𝒍𝒂𝒊𝒎 𝑩𝒆𝒓𝒉𝒂𝒔𝒊𝒍!  ♡⊹˚₊\n" +
                      `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა Yey! Hadiah ${input} berhasil diklaim!\n` +
                      `│ ✦ +${claim.reward} koin\n` +
                      `│ ♡ Koin sekarang › ${senderDb.coin} koin\n` +
                      "│ (｡•̀ᴗ-)✧ Jangan lupa klaim lagi nanti ya! ♡\n" +
                      "╰───────────────୨୧",
                buttons: [
                    {
                        text: "♡ Cek Koin",
                        id: `${ctx.used.prefix}coin`
                    },
                    {
                        text: "୨୧ Profile Saya",
                        id: `${ctx.used.prefix}profile`
                    }
                ]
            });
        } catch (error) {
            await ctx.helper.handleError(ctx, error);
        }
    }
};