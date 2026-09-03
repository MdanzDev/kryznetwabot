module.exports = {
    name: "dice",
    aliases: ["dadu"],
    category: "game",
    code: async (ctx) => {
        const input = parseInt(ctx.args[0]);
        if (isNaN(input) || input < 1 || input > 6)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "4")}\n` +
                ctx.format.generateNotes([
                    "Tebak angka dadu antara 1-6."
                ])
            );

        const senderDb = ctx.db.user;
        const isUnlimited = ctx.sender.isOwner() || senderDb?.premium;
        if (!isUnlimited && senderDb?.coin < 500) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Koin kamu tidak cukup! Minimal memiliki 500 koin untuk bermain ya~ ♡"));

        try {
            const result = Math.floor(Math.random() * 6) + 1;
            const isWin = input === result;
            let prizeText = "";

            if (isWin) {
                const prize = 1000;
                if (!isUnlimited) senderDb.coin += prize;
                prizeText = `+${prize} koin 🪙`;
            } else {
                const forfeit = 500;
                if (!isUnlimited) senderDb.coin -= forfeit;
                prizeText = `-${forfeit} koin 💔`;
            }

            if (!isUnlimited) senderDb.save();

            const diceEmojis = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
            const statusKaomoji = isWin ? "૮ ˶ᵔ ᵕ ᵔ˶ ა" : "(｡•́︿•̀｡)";
            const statusTitle = isWin ? "𝒀𝒆𝒚, 𝑴𝒆𝒏𝒂𝒏𝒈!" : "𝒀𝒂𝒉, 𝑲𝒂𝒍𝒂𝒉~";
            const text =
                "╭───────────────୨୧\n" +
                `│  ₊˚⊹♡  ${statusTitle}  ♡⊹˚₊\n` +
                `│ ${statusKaomoji} Dadu berhenti di: ${diceEmojis[result - 1] || "🎲"} ${result}!\n` +
                `│ ✦ Hadiah  › ${prizeText}\n` +
                `│ ♡ Tebakan › ${input}\n` +
                "│ (｡•̀ᴗ-)✧ Mau lempar dadu lagi? Tekan tombol ya! ♡\n" +
                "╰───────────────୨୧";

            await ctx.reply({
                text,
                buttons: [
                    {
                        text: `♡ Tebak Lagi (${input})`,
                        id: `${ctx.used.prefix}dice ${input}`
                    },
                    {
                        text: "୨୧ Lempar Acak",
                        id: `${ctx.used.prefix}dice ${Math.floor(Math.random() * 6) + 1}`
                    },
                    {
                        text: "♡ Cek Koin",
                        id: `${ctx.used.prefix}coin`
                    }
                ]
            });
        } catch (error) {
            await ctx.helper.handleError(ctx, error);
        }
    }
};