module.exports = {
    name: "autodownload",
    aliases: ["autodl"],
    category: "profile",
    code: async (ctx) => {
        const senderDb = ctx.db.user;
        const newStatus = !senderDb?.autodownload;
        senderDb.autodownload = newStatus;
        senderDb.save();

        const statusText = newStatus ? "diaktifkan ✨" : "dinonaktifkan 💤";
        const text =
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑨𝒖𝒕𝒐 𝑫𝒐𝒘𝒏𝒍𝒐𝒂𝒅  ♡⊹˚₊\n" +
            `│ (｡･ω･｡) Auto download link berhasil ${statusText}!\n` +
            "│ (｡•̀ᴗ-)✧ Sekarang kirim link sosial media langsung diproses ya~ ♡\n" +
            "╰───────────────୨୧";

        await ctx.reply({
            text,
            buttons: [
                {
                    text: newStatus ? "୨୧ Matikan Auto DL" : "♡ Aktifkan Auto DL",
                    id: `${ctx.used.prefix}autodownload`
                },
                {
                    text: "♡ Profile Saya",
                    id: `${ctx.used.prefix}profile`
                }
            ]
        });
    }
};