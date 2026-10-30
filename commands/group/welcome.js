// welcome.js — see and preview the group's welcome/goodbye/intro templates.
//
// settext.js already lets you SET the text, but you had to imagine the result:
// placeholders only resolve at send time, inside events/welcome.js. This shows
// the real rendered output (and the variable list) so a typo is visible before
// the next person joins.
//
// Deliberately reuses applyPlaceholders from events/welcome.js — a second
// implementation would drift from what actually gets sent.
"use strict";
const { applyPlaceholders } = require("../../events/welcome");

// Same keys buildPlaceholders() supplies, documented for the user.
const VARIABLES = [
    ["{tag}", "tag @ orang"],
    ["{name}", "nama push"],
    ["{number}", "nombor telefon"],
    ["{group}", "nama grup"],
    ["{desc}", "deskripsi grup"],
    ["{count}", "jumlah ahli"],
    ["{date}", "DD/MM/YYYY"],
    ["{time}", "HH:mm"],
    ["{day}", "nama hari"],
    ["{datetime}", "tarikh + masa"],
    ["{prefix}", "prefix bot"],
    ["{botname}", "nama bot"]
];

// A believable sample so the preview is readable, not full of blanks.
function sampleMap(ctx) {
    const groupDb = ctx.db?.group;
    const subject = String(ctx.group?.subject || "Grup Contoh");
    return {
        tag: "@60123456789",
        mention: "@60123456789",
        user: "Ali",
        name: "Ali",
        username: "Ali",
        sender: "@60123456789",
        jid: "60123456789@s.whatsapp.net",
        number: "60123456789",
        subject,
        group: subject,
        groupname: subject,
        description: groupDb?.text?.intro || "Deskripsi grup contoh",
        desc: groupDb?.text?.intro || "Deskripsi grup contoh",
        count: "12",
        members: "12",
        time: "09:30",
        date: "30/10/2026",
        day: "Jumaat",
        datetime: "Jumaat, 30 Oktober 2026 09:30",
        prefix: ctx.used?.prefix || ".",
        botname: "Alya"
    };
}

module.exports = {
    name: "welcome",
    aliases: ["cekwelcome", "welcomepreview"],
    category: "group",
    permissions: { group: true },
    description: "Lihat & preview teks welcome/goodbye/intro grup",
    cooldown: 3,
    code: async (ctx) => {
        if (!ctx.isGroup()) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Khusus dalam grup."));

        const groupDb = ctx.db?.group;
        if (!groupDb) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Data grup tak ada."));

        const p = ctx.used?.prefix || ".";
        const text = groupDb.text || {};
        const opt = groupDb.option || {};
        const map = sampleMap(ctx);

        const arg = String(ctx.args?.[0] || "").toLowerCase();

        // .welcome vars
        if (arg === "vars" || arg === "variables") {
            return await ctx.reply(ctx.format.info(
                `❖ *Pemboleh ubah* (guna dalam teks)\n\n` +
                VARIABLES.map(([k, v]) => `♡ ${ctx.format.inlineCode(k)} — ${v}`).join("\n") +
                `\n\n♡ Contoh: ${p}setwelcome Hai {name}! Selamat datang ke {group} 🎉`
            ));
        }

        const render = (key, label) => {
            const raw = text[key];
            if (!raw) return `✦ *${label}* — (tiada, guna default bot)`;
            return `✦ *${label}*\n${applyPlaceholders(raw, map)}`;
        };

        const status = [
            `♡ Welcome : ${opt.welcome ? "✅ hidup" : "❌ mati"}`,
            `♡ Goodbye : ${opt.goodbye ? "✅ hidup" : "❌ mati"}`
        ].join("\n");

        return await ctx.reply(ctx.format.info(
            `❖ *Teks grup* — preview\n\n` +
            `${status}\n\n` +
            `${render("welcome", "Welcome")}\n\n` +
            `${render("goodbye", "Goodbye")}\n\n` +
            `${render("intro", "Intro")}\n\n` +
            `♡ Set: ${p}setwelcome <teks>\n` +
            `♡ Senarai pemboleh ubah: ${p}welcome vars`
        ));
    }
};
