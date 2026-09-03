module.exports = {
    name: "price",
    aliases: ["belibot", "harga", "sewa", "sewabot"],
    category: "information",
    code: async (ctx) => {
        const customText = ctx.db.bot.text?.price;
        const text = customText ? customText.replace(/%tag%/g, `@${ctx.getId(ctx.sender.lid)}`).replace(/%name%/g, config.bot.name).replace(/%prefix%/g, ctx.used.prefix).replace(/%command%/g, ctx.used.command).replace(/%footer%/g, config.msg.footer).replace(/%readmore%/g, "\u200E".repeat(4001)) :
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑷𝒓𝒊𝒄𝒆 𝑳𝒊𝒔𝒕  ♡⊹˚₊\n" +
            "│  (｡･ω･｡)ﾉ♡ Info Sewa & Premium!\n" +
            "╰───────────────୨୧\n\n" +
            "╭┈┈┈┈┈┈┈┈୨୧\n" +
            "┊ ✦ 𝑷𝒓𝒆𝒎𝒊𝒖𝒎 𝑼𝒔𝒆𝒓 ୨୧\n" +
            "┊ ♡ Akses semua fitur tanpa batas koin!\n" +
            "┊ ♡ Prioritas proses & bebas cooldown\n" +
            "┊\n" +
            "┊ ✦ 𝑺𝒆𝒘𝒂 𝑩𝒐𝒕 𝑮𝒓𝒖𝒑 ୨୧\n" +
            "┊ ♡ Masukkan bot ke dalam grup kamu!\n" +
            "┊ ♡ Fitur moderasi grup lengkap & game seru\n" +
            "╰┈┈┈┈┈┈┈┈୨୧\n\n" +
            "╭───────────────୨୧\n" +
            "│ (｡•̀ᴗ-)✧ Tertarik? Hubungi owner ya! ♡\n" +
            "╰───────────────୨୧";

        await ctx.reply({
            text,
            mentions: [ctx.sender.lid],
            buttons: [
                {
                    text: "♡ Hubungi Owner",
                    id: `${ctx.used.prefix}owner`
                },
                {
                    text: "୨୧ Dukung Dev",
                    id: `${ctx.used.prefix}donate`
                }
            ]
        });
    }
};