// aiconfig.js — per-chat AI switches for WhatsApp.
//
// Mirrors the Telegram bot's /voice toggle, but as one namespaced command so
// further switches have a home instead of spawning .audioconfig, .xyzconfig...
//
//   .aiconfig                 -> show all switches for this chat
//   .aiconfig audio           -> toggle audio replies on/off
//   .aiconfig audio on|off    -> set explicitly
//
// Audio mode sends a voice note IN ADDITION to the text reply, exactly like the
// Telegram /voice behaviour ("teks tetap ada"), so a TTS failure never costs the
// answer.
const autoAi = require("/root/kryznetwabot/lib/wa-autoai");

const SWITCHES = {
    audio: {
        label: "Audio (balas dengan voice note)",
        get: (id) => autoAi.isAudioEnabled(id),
        set: (id, v) => autoAi.setAudioEnabled(id, v)
    },
    roast: {
        label: "Roast AI (Alya sindir kau setiap kali balas + drama tiap 10 min)",
        get: (id) => autoAi.isRoastEnabled(id),
        set: (id, v) => autoAi.setRoastEnabled(id, v)
    }
};

const help = (ctx) => {
    const p = ctx.used?.prefix || ".";
    return ctx.format.info(
        `❖ AI config — chat ni\n\n` +
        Object.entries(SWITCHES)
            .map(([k, s]) => `♡ ${p}aiconfig ${k} — ${s.get(ctx.id) ? "AKTIF ✅" : "MATI ❌"}\n   ${s.label}`)
            .join("\n") +
        `\n\n♡ Tukar: ${p}aiconfig audio on|off`
    );
};

module.exports = [{
    name: "aiconfig",
    aliases: ["aiconf", "aiconfig"],
    category: "tool",
    description: "Tetapan AI per-chat (audio on/off)",
    cooldown: 3,
    code: async (ctx) => {
        const args = (ctx.args || []).map((a) => String(a).toLowerCase());
        const key = args[0];
        const val = args[1];

        // No args (or "list") -> show current state.
        if (!key || key === "list") return await ctx.reply(help(ctx));

        const sw = SWITCHES[key];
        if (!sw) {
            const p = ctx.used?.prefix || ".";
            return await ctx.reply(ctx.format.info(
                `(｡•́︿•̀｡) Tetapan "${key}" tak ada.\n\n` +
                `♡ Yang ada: ${Object.keys(SWITCHES).join(", ")}\n` +
                `♡ Contoh: ${p}aiconfig audio on`
            ));
        }

        // Bare key -> toggle (same feel as Telegram's /voice).
        let next;
        if (!val) next = !sw.get(ctx.id);
        else if (["on", "true", "1", "ya"].includes(val)) next = true;
        else if (["off", "false", "0", "tak"].includes(val)) next = false;
        else {
            const p = ctx.used?.prefix || ".";
            return await ctx.reply(ctx.format.info(
                `(｡•́︿•̀｡) Nilai "${val}" tak faham.\n♡ Guna: ${p}aiconfig ${key} on|off`
            ));
        }

        sw.set(ctx.id, next);

        if (key === "audio") {
            return await ctx.reply(ctx.format.info(next
                ? `(｡･ω･｡)⁠ﾉ♡ Siap! Alya akan balas dengan voice note juga, teks tetap ada.\n♡ Matikan: ${ctx.used?.prefix || "."}aiconfig audio off`
                : `(｡･ω･｡) Audio reply dah dimatikan. Balas teks sahaja.`));
        }
        return await ctx.reply(help(ctx));
    }
}];
