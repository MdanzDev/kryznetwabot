const pkg = require("../../package.json");

module.exports = {
    name: "about",
    aliases: ["bot", "infobot"],
    category: "information",
    code: async (ctx) => {
        const groups = Object.values(await ctx.core.groupFetchAllParticipating()).filter(g => !g.announce && !g.isCommunity && !g.isCommunityAnnounce);

        const text =
            "╭───────────────୨୧\n" +
            `│  ₊˚⊹♡  𝑨𝒃𝒐𝒖𝒕 𝑴𝒆  ♡⊹˚₊\n` +
            `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა Halo! Aku ${config.bot.name} ♡\n` +
            `│ Asisten kecil WhatsApp siap membantu kamu~\n` +
            "╰───────────────୨୧\n\n" +
            "╭┈┈┈┈┈┈┈┈୨୧\n" +
            "┊ ✦ 𝑰𝒏𝒇𝒐𝒓𝒎𝒂𝒕𝒊𝒐𝒏 ୨୧\n" +
            `┊ ♡ Nama Bot  › ${config.bot.name}\n` +
            `┊ ♡ Versi     › v${pkg.version}\n` +
            `┊ ♡ Pemilik   › ${config.owner.name}\n` +
            `┊ ♡ Mode      › ${ctx.format.ucwords(ctx.db.bot?.mode || "public")}\n` +
            `┊ ♡ Aktif     › ${ctx.format.convertMsToDuration(Date.now() - ctx.me.readyAt)}\n` +
            `┊ ♡ Pengguna  › ${ctx.db.users.totalEntries} users\n` +
            `┊ ♡ Grup      › ${ctx.db.groups.totalEntries}/${groups.length} groups\n` +
            `┊ ♡ Library   › Baileys (${ctx.helper.getBaileysVersion()})\n` +
            "╰┈┈┈┈┈┈┈┈୨୧\n\n" +
            "╭───────────────୨୧\n" +
            "│ (｡･ω･｡)ﾉ♡ Terima kasih sudah menemani!\n" +
            "│ 𝒀𝒐𝒖𝒓 𝒔𝒖𝒑𝒑𝒐𝒓𝒕 𝒎𝒆𝒂𝒏𝒔 𝒂 𝒍𝒐𝒕 ♡\n" +
            "╰───────────────୨୧";

        await ctx.reply({
            text,
            buttons: [
                {
                    text: "♡ Menu Utama",
                    id: `${ctx.used.prefix}menu`
                },
                {
                    text: "୨୧ Hubungi Owner",
                    id: `${ctx.used.prefix}owner`
                },
                {
                    text: "♡ Dukung Dev",
                    id: `${ctx.used.prefix}donate`
                }
            ]
        });
    }
};