// localfun.js — fun commands that need NO external API.
//
// Every quiz/tebak game depends on siputzx; two features (kimi-k3, nexray) have
// already died on us. These read from local data, so they cannot rot.
//
// .8ball and .wouldyourather are tiny; .emojiquiz is the interesting one — it
// reuses the game-session invariant via a plain collector, with the same rule
// as every other game: only a real timeout announces "time's up".
"use strict";
const { createGameSessions } = require("../../lib/game-session");

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle(a) {
    const r = [...a];
    for (let i = r.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
}

// ---- 8ball ---------------------------------------------------------------
const EIGHTBALL = [
    ["Ya, teruskan. ✅", ["ya", "y"]],
    ["Tak. Jangan. ❌", ["no", "n"]],
    ["Mungkin kot. 🤔", ["maybe", "m"]],
    ["Tanya lagi nanti, aku tengah blur. 😵‍💫", ["ask-again", "a"]],
    ["Aku rasa tak elok. ⚠️", ["careful", "c"]],
    ["Memang confirm. 💯", ["yes-def", "yd"]],
    ["Jangan harap. 🙃", ["no-def", "nd"]],
    ["Ada orang akan tolong kau. 🤝", ["help", "h"]],
    ["Duit jadi masalah. 💸", ["money"]],
    ["Kau dah tahu jawabannya sebenarnya. 👀", ["know"]]
];

// ---- would you rather ----------------------------------------------------
const WYR = [
    ["Tak boleh guna WhatsApp seminggu", "Tak boleh guna YouTube sebulan"],
    ["Dapat RM1000 sekarang", "Dapat RM5000 tahun depan"],
    ["Kerja dari rumah selamanya", "Kerja ofis tapi gaji double"],
    ["Kawan yang selalu pinjam duit", "Kawan yang selalu lambat 2 jam"],
    ["Internet laju tapi mahal", "Internet slow tapi free"],
    ["Boleh terbang tapi tak boleh masuk rumah", "Boleh halimunan tapi tak boleh bercakap"],
    ["Hidup tanpa kopi", "Hidup tanpa nasik"],
    ["Phone flagship tapi takde camera", "Phone murah tapi camera gempak"],
    ["Selalu kena tag dalam grup", "Selalu kena ignore dalam grup"],
    ["Gaji besar tapi kerja 12 jam", "Gaji sederhana tapi kerja 4 jam"]
];

// ---- emoji quiz ----------------------------------------------------------
// Local dataset: emoji -> the answer. No network, no API key, no rot.
const EMOJI_Q = [
    { e: "🦁👑", a: "lion king" },
    { e: "🕷️👨", a: "spiderman" },
    { e: "❄️👸", a: "frozen" },
    { e: "🚢🧊💔", a: "titanic" },
    { e: "🦈🌊", a: "jaws" },
    { e: "👻🚫", a: "ghostbuster" },
    { e: "🐟🔍", a: "finding nemo" },
    { e: "🧸🤠", a: "toy story" },
    { e: "🚗⚡", a: "fast and furious" },
    { e: "🕶️🔫", a: "matrix" },
    { e: "🐉🥋", a: "karate kid" },
    { e: "🍫🏭", a: "charlie and the chocolate factory" },
    { e: "🌪️🏠👠", a: "wizard of oz" },
    { e: "🦍🏙️", a: "king kong" },
    { e: "🐧🎶", a: "happy feet" },
    { e: "🔴🐼", a: "turning red" },
    { e: "👽📞", a: "et" },
    { e: "🏴‍☠️💎", a: "pirates of the caribbean" },
    { e: "🧙‍♂️💍", a: "lord of the rings" },
    { e: "🕵️‍♂️🔍", a: "sherlock" }
];

const normalize = (s) => String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const sessions = createGameSessions();

module.exports = [
    // ---------- .8ball ----------
    {
        name: "8ball",
        aliases: ["tanya", "magic8"],
        category: "game",
        description: "Tanya soalan ya/tak, bot jawab",
        cooldown: 4,
        code: async (ctx) => {
            const q = String(ctx.text || "").trim();
            if (!q) {
                const p = ctx.used?.prefix || ".";
                return await ctx.reply(ctx.format.info(
                    `(｡•́︿•̀｡) Tanya sesuatu dulu.\n\n♡ ${p}8ball aku patut beli phone baru tak?`
                ));
            }
            if (q.length > 200)
                return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Soalan tu panjang sangat. Pendekkan sikit."));

            const [answer] = pick(EIGHTBALL);
            return await ctx.reply(ctx.format.info(
                `❖ *8-ball* 🎱\n\n♡ ${q.slice(0, 120)}\n\n*${answer}*`
            ));
        }
    },

    // ---------- .wyr / would you rather ----------
    {
        name: "wyr",
        aliases: ["wouldyourather", "pilihmana"],
        category: "game",
        description: "Would you rather — dua pilihan",
        cooldown: 5,
        code: async (ctx) => {
            const [a, b] = pick(WYR);
            return await ctx.reply(ctx.format.info(
                `❖ *Would you rather…* 🤔\n\n` +
                `🅰️ ${a}\n\n` +
                `🅱️ ${b}\n\n` +
                `♡ Reply A atau B.`
            ));
        }
    },

    // ---------- .emojiquiz ----------
    {
        name: "emojiquiz",
        aliases: ["emoji", "tebakemoji"],
        category: "game",
        description: "Teka filem dari emoji",
        cooldown: 5,
        code: async (ctx) => {
            const key = `emoji_${ctx.id}`;
            if (sessions.isActive(key))
                return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Sesi emoji quiz sedang berjalan! Selesaikan atau tunggu."));

            const q = pick(EMOJI_Q);
            // Accept a few near-misses so the game stays fun rather than pedantic.
            const accepted = new Set([normalize(q.a)]);
            if (q.a.includes(" ")) accepted.add(normalize(q.a.split(" ")[0]));

            sessions.start(key, { timeoutMs: 45000 });

            await ctx.reply(ctx.format.info(
                `❖ *Teka filem* 🎬\n\n${q.e}\n\n` +
                `♡ Jawab dalam ${ctx.format.convertMsToDuration(45000)}`
            ));

            const collector = ctx.MessageCollector({ time: 45000 });

            collector.on("collect", async (collCtx) => {
                const guess = normalize(collCtx.msg.body);
                if (!guess) return;

                if (accepted.has(guess)) {
                    sessions.end(key);
                    collector.stop();
                    const db = collCtx.db.user;
                    const unlimited = collCtx.sender.isOwner() || db?.premium;
                    if (!unlimited) db.coin = (db.coin || 0) + 50;
                    db.winGame = (db.winGame || 0) + 1;
                    db.save?.();
                    await collCtx.reply(ctx.format.info(
                        `✅ *Betul!* Jawapan: ${q.a}\n+50 koin 🪙`
                    ));
                }
            });

            collector.on("end", async (reason) => {
                // Same invariant as every other game: only a real timeout speaks.
                await sessions.onEnd(key, reason, async () => {
                    await ctx.reply(ctx.format.info(
                        `(｡•́︿•̀｡) Waktu habis! Jawapan: *${q.a}*`
                    ));
                });
            });
        }
    }
];
