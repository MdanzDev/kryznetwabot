// relationship.js — how long Alya has known you.
//
// soul.js already tracks per-user affection (score, chat days, first chat,
// familiarity tier) and can render a report — but only the Telegram bot could
// reach it. On WhatsApp the data was being collected and never shown.
//
// Identity MUST come from WaAlya.identityFor(), the same call the message path
// uses to key soul.touch(). Reading a different key here would report a
// stranger's stats (or zeroes).
"use strict";

// Rapport score -> what it means, without exposing internal numbers as the point.
function warmthLine(score) {
    if (score >= 200) return "kau dah macam kawan lama dah 🌸";
    if (score >= 100) return "kau dah familiar sangat dengan aku~";
    if (score >= 50) return "aku dah selesa borak dengan kau";
    if (score >= 0) return "kita baru kenal, tapi okay 😊";
    return "kita macam ada sejarah tak best...";
}

module.exports = {
    name: "relationship",
    aliases: ["rel", "kenal"],
    category: "tool",
    description: "Berapa lama Alya kenal kau",
    cooldown: 5,
    code: async (ctx) => {
        const wa = ctx.bot?.waAlya;
        const soul = wa?.tg?.soul;
        if (!soul?.getAffection)
            return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Soul tak aktif."));

        // Same key the bridge uses when it calls soul.touch().
        const { userId } = typeof wa.identityFor === "function"
            ? wa.identityFor(ctx)
            : { userId: ctx.getId(ctx.sender.jid) };

        const aff = soul.getAffection(userId);
        const mood = soul.getMood ? soul.getMood() : "?";

        // Never started: getAffection() fabricates firstChatAt = now, which would
        // read as "known for 0 days". Say so plainly instead.
        if (!aff.days) {
            return await ctx.reply(ctx.format.info(
                `(｡･ω･｡) Kita belum borak lagi kat sini.\n` +
                `♡ Mula sembang dulu, nanti aku ingat.`
            ));
        }

        const since = new Date(aff.firstChatAt).toLocaleDateString("en-MY", {
            timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "long", year: "numeric"
        });

        // Calendar span vs active days are different things and both matter.
        const spanDays = Math.max(1, Math.floor((Date.now() - aff.firstChatAt) / 86400000) + 1);

        const lines = [
            `❖ *Hubungan kita*`,
            ``,
            `♡ Kenal sejak › ${since}`,
            `♡ ${spanDays} hari lalu`,
            `♡ ${aff.days} hari kau sembang dengan aku`,
            `♡ Keakraban  › ${aff.tier.label}`,
            ``,
            `${warmthLine(aff.score)}`
        ];

        // Mood is shared (it is the bot's mood, not per-user) — label it as such.
        lines.push(`\n♡ Mood aku sekarang: ${mood}`);

        if (spanDays >= 7) {
            const weeks = Math.floor(spanDays / 7);
            if (weeks >= 1) lines.push(`♡ ${weeks} minggu 🎀`);
        }

        return await ctx.reply(ctx.format.info(lines.join("\n")));
    }
};
