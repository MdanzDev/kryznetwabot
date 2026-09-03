module.exports = {
    name: "reset",
    category: "profile",
    permissions: {
        private: true
    },
    code: async (ctx) => {
        const input = ctx.args[0]?.toLowerCase();
        if (input === "y" || input === "yes") {
            const usersDb = ctx.db.users;
            usersDb.reset(user => user.id === ctx.sender.lid);
            return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Database kamu telah berhasil direset kembali ke awal~ ♡"));
        } else if (input === "n" || input === "no") {
            return await ctx.reply(ctx.format.info("૮ ˶ᵔ ᵕ ᵔ˶ ა Proses reset database telah dibatalkan. Data kamu aman! ♡"));
        }

        await ctx.reply({
            text: "╭───────────────୨୧\n" +
                  "│  ₊˚⊹♡  𝑲𝒐𝒏𝒇𝒊𝒓𝒎𝒂𝒔𝒊 𝑹𝒆𝒔𝒆𝒕  ♡⊹˚₊\n" +
                  "│ (｡•́︿•̀｡) Kamu yakin ingin mereset database?\n" +
                  "│ Semua level, koin, dan data kamu akan terhapus lho...\n" +
                  "╰───────────────୨୧",
            buttons: [{
                text: "♡ Ya, Reset Data",
                id: `${ctx.used.prefix + ctx.used.command} yes`
            }, {
                text: "୨୧ Batalkan",
                id: `${ctx.used.prefix + ctx.used.command} no`
            }]
        });
    }
};