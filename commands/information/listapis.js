module.exports = {
    name: "listapis",
    aliases: ["listapi"],
    category: "information",
    code: async (ctx) => {
        const APIs = ctx.api.listUrl();
        const items = Object.values(APIs).map(api => `┊ ❖ ${api.baseURL}`).join("\n");
        const text =
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑳𝒊𝒔𝒕 𝑨𝑷𝑰𝒔  ♡⊹˚₊\n" +
            "│ (｡･ω･｡)ﾉ♡ Daftar API pendukung bot:\n" +
            "╰───────────────୨୧\n\n" +
            "╭┈┈┈┈┈┈┈┈୨୧\n" +
            "┊ ✦ 𝑩𝒂𝒔𝒆 𝑼𝑹𝑳 ୨୧\n" +
            items + "\n" +
            "╰┈┈┈┈┈┈┈┈୨୧\n\n" +
            "╭───────────────୨୧\n" +
            "│ (｡•̀ᴗ-)✧ Semua API berjalan lancar! ♡\n" +
            "╰───────────────୨୧";

        await ctx.reply(text);
    }
};