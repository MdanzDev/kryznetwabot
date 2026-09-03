module.exports = {
    name: "transfer",
    aliases: ["tf"],
    category: "profile",
    code: async (ctx) => {
        const target = await ctx.target();
        const coinAmount = parseInt(ctx.args[target.source === "quoted" ? 0 : 1], 10);
        if (!target || !coinAmount)
            return await ctx.reply({
                text: `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                    `${ctx.format.generateCmdExample(ctx.used, "@60137345871 8")}\n` +
                    ctx.format.generateNotes([
                        "Balas/quote pesan untuk menjadikan pengirim sebagai akun target."
                    ]),
                mentions: ["60137345871@s.whatsapp.net"]
            });

        const senderDb = ctx.db.user;
        if (ctx.sender.isOwner() || senderDb?.premium) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Koin tak terbatas tidak dapat ditransfer ya~ ♡"));
        if (coinAmount <= 0) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Jumlah koin harus lebih dari 0 ya~"));
        if (senderDb?.coin < coinAmount) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Koin kamu tidak mencukupi untuk transfer ini nih..."));
        if (ctx.checkOwner(target.id)) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Kamu tidak dapat mentransfer koin ke akun owner~ ♡"));

        try {
            const targetDb = ctx.getDb("users", target.id);
            targetDb.coin += coinAmount;
            senderDb.coin -= coinAmount;
            targetDb.save();
            senderDb.save();
            await ctx.reply({
                text: "╭───────────────୨୧\n" +
                      "│  ₊˚⊹♡  𝑻𝒓𝒂𝒏𝒔𝒇𝒆𝒓 𝑩𝒆𝒓𝒉𝒂𝒔𝒊𝒍!  ♡⊹˚₊\n" +
                      `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა Berhasil mentransfer koin!\n` +
                      `│ ✦ Jumlah › ${coinAmount} koin\n` +
                      `│ ♡ Sisa koin kamu › ${senderDb.coin} koin\n` +
                      "│ (｡•̀ᴗ-)✧ Terima kasih sudah berbagi! ♡\n" +
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