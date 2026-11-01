// aiconfig.js — per-chat AI switches for WhatsApp.
//
// One namespaced command instead of spawning .audioconfig, .roastconfig,
// .dramaconfig... Each setting is either a boolean switch or a value (the drama
// delay), described once in SETTINGS and rendered generically.
//
//   .aiconfig                    -> show every setting for this chat
//   .aiconfig audio              -> toggle
//   .aiconfig audio on|off       -> set explicitly
//   .aiconfig drama off          -> stop timed drama, keep roasts
//   .aiconfig dramadelay 30m     -> drama every 30 minutes in this chat
const autoAi = require("/root/kryznetwabot/lib/wa-autoai");
const { parseDuration, convertMsToDuration } = require("/root/kryznetwabot/lib/format");

// kind: "switch" toggles; "value" takes an argument (duration).
const SETTINGS = {
    audio: {
        kind: "switch",
        label: "Audio — balas dengan voice note",
        get: (id) => autoAi.isAudioEnabled(id),
        set: (id, v) => autoAi.setAudioEnabled(id, v)
    },
    roast: {
        kind: "switch",
        label: "Roast — sindir kau setiap kali Alya balas",
        get: (id) => autoAi.isRoastEnabled(id),
        set: (id, v) => autoAi.setRoastEnabled(id, v),
        note: "Drama ikut sama: kalau roast mati, drama pun mati."
    },
    toxic: {
        kind: "switch",
        label: "Toxic — Alya lawan balik orang biadab/ragebait",
        get: (id) => autoAi.isToxicEnabled(id),
        set: (id, v) => autoAi.setToxicEnabled(id, v),
        note: "Masih tak sentuh rupa/agama/bangsa/keluarga. Off = Alya sabar macam biasa."
    },
    drama: {
        kind: "switch",
        label: "Drama — Alya mula drama secara berkala",
        get: (id) => autoAi.isDramaEnabled(id),
        set: (id, v) => autoAi.setDramaEnabled(id, v),
        note: "Perlu roast ON juga."
    },
    dramadelay: {
        kind: "value",
        label: "Drama delay — berapa kerap drama bermula",
        get: (id) => autoAi.getDramaInterval(id),
        set: (id, v) => autoAi.setDramaInterval(id, v),
        render: (v) => convertMsToDuration(v),
        example: "30m"
    }
};

const p = (ctx) => ctx.used?.prefix || ".";

const render = (ctx) => {
    const lines = Object.entries(SETTINGS).map(([k, s]) => {
        const v = s.get(ctx.id);
        const state = s.kind === "switch"
            ? (v ? "AKTIF ✅" : "MATI ❌")
            : (s.render ? s.render(v) : String(v));
        return `♡ ${p(ctx)}aiconfig ${k} — ${state}\n   ${s.label}${s.note ? `\n   ${s.note}` : ""}`;
    });

    return ctx.format.info(
        `❖ AI config — chat ni\n\n${lines.join("\n")}\n\n` +
        `♡ Tukar: ${p(ctx)}aiconfig audio on|off\n` +
        `♡ Delay: ${p(ctx)}aiconfig dramadelay 30m`
    );
};

const TRUE_VALS = ["on", "true", "1", "ya", "aktif"];
const FALSE_VALS = ["off", "false", "0", "tak", "mati"];

module.exports = [{
    name: "aiconfig",
    aliases: ["aiconf"],
    category: "tool",
    description: "Tetapan AI per-chat (audio / roast / drama / delay)",
    cooldown: 3,
    code: async (ctx) => {
        const args = (ctx.args || []).map((a) => String(a).toLowerCase());
        const key = args[0];
        const val = args[1];

        if (!key || key === "list") return await ctx.reply(render(ctx));

        const s = SETTINGS[key];
        if (!s) {
            return await ctx.reply(ctx.format.info(
                `(｡•́︿•̀｡) Tetapan "${key}" tak ada.\n\n` +
                `♡ Yang ada: ${Object.keys(SETTINGS).join(", ")}\n` +
                `♡ Contoh: ${p(ctx)}aiconfig drama off`
            ));
        }

        // ---- value setting (duration) ----
        if (s.kind === "value") {
            if (!val) {
                return await ctx.reply(ctx.format.info(
                    `(｡•́︿•̀｡) ${key} sekarang: ${s.render(s.get(ctx.id))}\n` +
                    `♡ Set: ${p(ctx)}aiconfig ${key} ${s.example || "30m"}`
                ));
            }
            const ms = parseDuration(val);
            if (!ms) {
                return await ctx.reply(ctx.format.info(
                    `(｡•́︿•̀｡) "${val}" bukan masa yang aku faham.\n` +
                    `♡ Contoh: ${p(ctx)}aiconfig ${key} 30m\n` +
                    `♡ Atau: 1j, 2 jam, 90 minit\n` +
                    `♡ Minimum: ${convertMsToDuration(autoAi.MIN_DRAMA_MS)}`
                ));
            }
            s.set(ctx.id, ms);
            return await ctx.reply(ctx.format.info(
                `(｡･ω･｡)⁠ﾉ♡ Siap! Drama akan mula setiap ${convertMsToDuration(ms)} dalam chat ni.\n\n` +
                render(ctx)
            ));
        }

        // ---- boolean switch ----
        let next;
        if (!val) next = !s.get(ctx.id);                 // bare key toggles
        else if (TRUE_VALS.includes(val)) next = true;
        else if (FALSE_VALS.includes(val)) next = false;
        else {
            return await ctx.reply(ctx.format.info(
                `(｡•́︿•̀｡) Nilai "${val}" tak faham.\n♡ Guna: ${p(ctx)}aiconfig ${key} on|off`
            ));
        }

        s.set(ctx.id, next);

        // Drama is gated on roast; say so when it would have no effect.
        if (key === "drama" && next && !autoAi.isRoastEnabled(ctx.id)) {
            return await ctx.reply(ctx.format.info(
                `(｡•́︿•̀｡) Drama dah ON, tapi roast masih MATI — drama takkan jalan.\n\n` +
                `♡ Hidupkan roast: ${p(ctx)}aiconfig roast on`
            ));
        }

        return await ctx.reply(render(ctx));
    }
}];
