// persona.js — tune Alya's mood mix.
//
// The soul already rolls a mood each day and rotates it mid-day, but the weights
// were hardcoded to an even split. This exposes them so you can make her mostly
// cheerful, or dial down the sulky days, without editing code.
//
// Owner-only: mood drives how she talks to everyone, so it is a global setting.
const WEEK = 7;

module.exports = {
    name: "persona",
    aliases: ["mood", "moods"],
    category: "owner",
    description: "Atur bobot mood Alya (ceria, ngantuk, clingy...)",
    cooldown: 3,
    code: async (ctx) => {
        if (!ctx.sender.isOwner())
            return await ctx.reply(ctx.format.info("(｡•ˇ‸ˇ•｡) Khusus owner ya~"));

        const soul = ctx.bot?.waAlya?.tg?.soul;
        if (!soul?.getMoodWeights)
            return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Soul tak aktif."));

        const p = ctx.used?.prefix || ".";
        const args = (ctx.args || []).map((a) => String(a).toLowerCase());

        const current = soul.getMoodWeights();
        const moods = Object.keys(current);
        const total = Object.values(current).reduce((a, b) => a + b, 0) || 1;

        // .persona            -> show mix
        // .persona reset      -> even split
        if (!args.length || args[0] === "list") {
            const lines = moods
                .map((m) => {
                    const pct = Math.round((current[m] / total) * 100);
                    const bar = "█".repeat(Math.round(pct / 10)).padEnd(10, "·");
                    return `♡ ${m.padEnd(10)} ${bar} ${String(pct).padStart(3)}%`;
                })
                .join("\n");
            return await ctx.reply(ctx.format.info(
                `❖ *Persona Alya*\n\n${lines}\n\n` +
                `♡ Ubah: ${p}persona set cheerful 5\n` +
                `♡ Reset: ${p}persona reset`
            ));
        }

        if (args[0] === "reset") {
            const even = {};
            for (const m of moods) even[m] = 1;
            soul.setMoodWeights(even);
            return await ctx.reply(ctx.format.info("(｡･ω･｡) Persona dah reset ke taburan sama rata."));
        }

        // .persona set <mood> <weight>
        if (args[0] === "set") {
            const mood = args[1];
            const weight = parseInt(args[2], 10);

            if (!moods.includes(mood)) {
                return await ctx.reply(ctx.format.info(
                    `(｡•́︿•̀｡) Mood "${mood || "-"}" tak ada.\n\n♡ Pilihan: ${moods.join(", ")}`
                ));
            }
            if (!Number.isFinite(weight) || weight < 0 || weight > 10) {
                return await ctx.reply(ctx.format.info(
                    `(｡•́︿•̀｡) Bobot kena antara 0 dan 10.\n♡ Contoh: ${p}persona set ${mood} 5`
                ));
            }

            const next = { ...current, [mood]: weight };
            const saved = soul.setMoodWeights(next);
            const newTotal = Object.values(saved).reduce((a, b) => a + b, 0) || 1;
            const pct = Math.round((saved[mood] / newTotal) * 100);

            return await ctx.reply(ctx.format.info(
                `(｡･ω･｡) *${mood}* sekarang bobot ${weight} (~${pct}%).\n` +
                `♡ Mood semasa: ${soul.mood || "-"}\n` +
                `♡ Terpakai pada rotation seterusnya.`
            ));
        }

        return await ctx.reply(ctx.format.info(
            `(｡•́︿•̀｡) Format tak faham.\n\n` +
            `♡ ${p}persona\n` +
            `♡ ${p}persona set <mood> <0-10>\n` +
            `♡ ${p}persona reset`
        ));
    }
};
