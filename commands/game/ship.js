// ship.js — pair two random members. Group fun only.
//
// Roster comes from buildRanking() (lib/group-rank.js), the same authoritative
// source as .topsider/.whois/.kickidle. That matters: pairing from the tracked
// rows would include people who already left, and the bot itself is a "member"
// in its own list — shipping Alya with someone would be a bug, not a joke.
"use strict";
const { buildRanking } = require("../../lib/group-rank");

// Playful but harmless. No romantic claims about real people beyond the joke.
const VERDICTS = [
    { max: 20, label: "kawan sejati 💛", line: "korang dua macam dah kenal 10 tahun." },
    { max: 40, label: "kenalan baik 🙂", line: "boleh borak lama, takde awkward." },
    { max: 60, label: "sama frekuensi 🎧", line: "suka barang yang sama, faham sama-sama." },
    { max: 80, label: "chemistry kuat 🔥", line: "korang kalau bergabung, grup jadi meriah." },
    { max: 95, label: "soulmate 🫶", line: "serius, korang dua memang padan." },
    { max: 100, label: "JODOH DITENTUKAN 🎀", line: "alam semesta dah set. jangan lawan." }
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Deterministic-ish score so the same pair feels consistent within a day,
// but still fresh tomorrow. Cheap hash; no crypto needed for a joke.
function scoreFor(a, b) {
    const key = [String(a), String(b)].sort().join("|") + "|" + new Date().toDateString();
    let h = 0;
    for (let i = 0; i < key.length; i++) {
        h = (h * 31 + key.charCodeAt(i)) >>> 0;
    }
    return (h % 101); // 0..100
}

const verdictFor = (pct) => VERDICTS.find((v) => pct <= v.max) || VERDICTS[VERDICTS.length - 1];

const bar = (pct) => {
    const filled = Math.round(pct / 10);
    return "█".repeat(filled).padEnd(10, "·");
};

module.exports = {
    name: "ship",
    aliases: ["jodoh", "match"],
    category: "game",
    description: "Ship 2 ahli grup secara rawak",
    cooldown: 8,
    code: async (ctx) => {
        if (!ctx.isGroup())
            return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) .ship cuma boleh dalam grup — nak ship siapa kat sini? 😅"));

        let rows;
        try {
            rows = (await buildRanking(ctx)) || [];
        } catch (e) {
            return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Gagal baca senarai ahli: ${e.message}`));
        }

        // Never ship the bot. `isBot` comes from group-rank, which matches both
        // the PN and LID identities.
        const pool = rows.filter((r) => !r.isBot);

        if (pool.length < 2) {
            return await ctx.reply(ctx.format.info(
                `(｡･ω･｡) Kena ada sekurang-kurangnya 2 ahli untuk ship.\n♡ Sekarang: ${pool.length}`
            ));
        }

        // Two DIFFERENT people. Shuffle a copy, take the first two.
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const [a, b] = shuffled;

        const pct = scoreFor(a.id, b.id);
        const verdict = verdictFor(pct);

        const nameA = String(a.name).slice(0, 24);
        const nameB = String(b.name).slice(0, 24);

        // Mentioning both makes it land in the group as a real ping.
        const mentions = [a.id, b.id].filter(Boolean);

        return await ctx.reply({
            text:
                `❖ *SHIP!* 💘\n\n` +
                `♡ @${ctx.getId(a.id)} ✕ @${ctx.getId(b.id)}\n\n` +
                `♡ ${bar(pct)} ${pct}%\n` +
                `♡ Status › ${verdict.label}\n` +
                `${verdict.line}\n\n` +
                `— ${nameA} & ${nameB}`,
            mentions
        });
    }
};
