module.exports = {
    name: "coinflip",
    aliases: ["flip"],
    category: "game",
    code: async (ctx) => {
        const input = ctx.args[0]?.toLowerCase();
        if (!input || !["garuda", "melati"].includes(input))
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "melati")}\n` +
                ctx.format.generateNotes([
                    "Sisi koin tersedia garuda atau melati, sama seperti koin Rp. 500."
                ])
            );

        const senderDb = ctx.db.user;
        const isUnlimited = ctx.sender.isOwner() || senderDb?.premium;
        if (!isUnlimited && senderDb?.coin < 500) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Koin kamu tidak cukup! Minimal memiliki 500 koin untuk bermain ya~ ♡"));

        try {
            const winRate = 0.40;
            const isWin = Math.random() < winRate;
            const flip = isWin ? input : (input === "garuda" ? "melati" : "garuda");
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

            const statusKaomoji = isWin ? "૮ ˶ᵔ ᵕ ᵔ˶ ა" : "(｡•́︿•̀｡)";
            const statusTitle = isWin ? "𝒀𝒆𝒚, 𝑴𝒆𝒏𝒂𝒏𝒈!" : "𝒀𝒂𝒉, 𝑲𝒂𝒍𝒂𝒉~";
            const text =
                "╭───────────────୨୧\n" +
                `│  ₊˚⊹♡  ${statusTitle}  ♡⊹˚₊\n` +
                `│ ${statusKaomoji} Koin jatuh di sisi: ${ctx.format.bold(flip.toUpperCase())}!\n` +
                `│ ✦ Hadiah  › ${prizeText}\n` +
                `│ ♡ Tebakan › ${input}\n` +
                "│ (｡•̀ᴗ-)✧ Mau coba lagi? Tekan tombol di bawah ya! ♡\n" +
                "╰───────────────୨୧";

            await ctx.reply({
                text,
                buttons: [
                    {
                        text: "♡ Main (Melati)",
                        id: `${ctx.used.prefix}coinflip melati`
                    },
                    {
                        text: "୨୧ Main (Garuda)",
                        id: `${ctx.used.prefix}coinflip garuda`
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