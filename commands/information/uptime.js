module.exports = {
    name: "uptime",
    aliases: ["runtime"],
    category: "information",
    code: async (ctx) => {
        const uptime = ctx.me?.readyAt ? ctx.format.convertMsToDuration(Date.now() - ctx.me.readyAt) : "Unknown";
        const text =
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑼𝒑𝒕𝒊𝒎𝒆 𝑩𝒐𝒕  ♡⊹˚₊\n" +
            `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა Bot telah aktif selama:\n` +
            `│ ✦ ${uptime}\n` +
            "│ (｡•̀ᴗ-)✧ Siap menemani aktivitas kamu setiap saat! ♡\n" +
            "╰───────────────୨୧";

        await ctx.reply({
            text,
            buttons: [
                {
                    text: "♡ Menu Utama",
                    id: `${ctx.used.prefix}menu`
                },
                {
                    text: "୨୧ Info Bot",
                    id: `${ctx.used.prefix}about`
                },
                {
                    text: "♡ Tes Ping",
                    id: `${ctx.used.prefix}ping`
                }
            ]
        });
    }
};