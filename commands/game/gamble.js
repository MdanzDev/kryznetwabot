module.exports = {
    name: "gamble",
    aliases: ["slot"],
    category: "game",
    code: async (ctx) => {
        const input = parseInt(ctx.args[0], 10);
        if (!input)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                ctx.format.generateCmdExample(ctx.used, "18")
            );

        const senderDb = ctx.db.user;
        const isUnlimited = ctx.sender.isOwner() || senderDb?.premium;
        if (input < 10) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Jumlah taruhan minimal 10 koin ya~ ♡"));
        if (!isUnlimited && senderDb?.coin < input) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Koin kamu tidak mencukupi untuk taruhan ini nih..."));

        try {
            const jackpotPrize = Math.ceil(input * 5);
            const winPrize = Math.ceil(input * 2);
            const emojis = ["🍏", "🍎", "🍊", "🍋", "🍑", "🪙", "🍅", "🍐", "🍒", "🥥", "🍌"];

            const topRow = Array.from({
                length: 3
            }, () => emojis[Math.floor(Math.random() * emojis.length)]);
            const middleRow = Array.from({
                length: 3
            }, () => emojis[Math.floor(Math.random() * emojis.length)]);
            const bottomRow = Array.from({
                length: 3
            }, () => emojis[Math.floor(Math.random() * emojis.length)]);

            const isJackpot = middleRow[0] === middleRow[1] && middleRow[1] === middleRow[2];
            const isWin = !isJackpot && (middleRow[0] === middleRow[1] || middleRow[0] === middleRow[2] || middleRow[1] === middleRow[2]);

            let responseText = "";
            if (isJackpot) {
                responseText = `Jackpot! +${jackpotPrize} koin (5x lipat) 🎉`;
                if (!isUnlimited) senderDb.coin += jackpotPrize;
            } else if (isWin) {
                responseText = `Menang! +${winPrize} koin (2x lipat) ✨`;
                if (!isUnlimited) senderDb.coin += winPrize;
            } else {
                responseText = `Kalah! Semoga beruntung lain kali. -${input} koin 💔`;
                if (!isUnlimited) senderDb.coin -= input;
            }

            if (!isUnlimited) senderDb.save();

            const statusTitle = isJackpot ? "𝑱𝒂𝒄𝒌𝒑𝒐𝒕!! 🎉" : (isWin ? "𝒀𝒆𝒚, 𝑴𝒆𝒏𝒂𝒏𝒈! ✨" : "𝒀𝒂𝒉, 𝑲𝒂𝒍𝒂𝒉~ 💔");
            const statusKaomoji = (isJackpot || isWin) ? "૮ ˶ᵔ ᵕ ᵔ˶ ა" : "(｡•́︿•̀｡)";

            const text =
                "╭───────────────୨୧\n" +
                `│  ₊˚⊹♡  ${statusTitle}  ♡⊹˚₊\n` +
                `│ ${statusKaomoji} ${responseText}\n` +
                "╰───────────────୨୧\n\n" +
                "╭┈┈┈┈┈┈┈┈୨୧\n" +
                "┊ ✦ 𝑴𝒆𝒔𝒊𝒏 𝑺𝒍𝒐𝒕 ୨୧\n" +
                `┊  [ ${topRow[0]} : ${topRow[1]} : ${topRow[2]} ]\n` +
                `┊ ⤿ [ ${middleRow[0]} : ${middleRow[1]} : ${middleRow[2]} ] ⤾ ✧\n` +
                `┊  [ ${bottomRow[0]} : ${bottomRow[1]} : ${bottomRow[2]} ]\n` +
                "╰┈┈┈┈┈┈┈┈୨୧\n\n" +
                "╭───────────────୨୧\n" +
                "│ (｡•̀ᴗ-)✧ Mau putar slot lagi? Tekan tombol ya! ♡\n" +
                "╰───────────────୨୧";

            await ctx.reply({
                text,
                buttons: [
                    {
                        text: `♡ Putar Lagi (${input})`,
                        id: `${ctx.used.prefix}gamble ${input}`
                    },
                    {
                        text: "୨୧ Cek Koin",
                        id: `${ctx.used.prefix}coin`
                    }
                ]
            });
        } catch (error) {
            await ctx.helper.handleError(ctx, error);
        }
    }
};