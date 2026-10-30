// Fun, low-stakes group commands. One file per concern would be 6 tiny files;
// they share a single invariant — pick people from the AUTHORITATIVE roster via
// buildRanking(), never the tracked rows (ghosts) and never the bot itself —
// so they live together and share `groupPool()`.
"use strict";
const { buildRanking } = require("../../lib/group-rank");

// ---- shared roster helper -------------------------------------------------
// Returns real, present humans in this group. Bot excluded (it lists itself as
// a member); departed members excluded (tracked rows outlive the roster).
async function groupPool(ctx) {
    const rows = (await buildRanking(ctx)) || [];
    return rows.filter((r) => !r.isBot);
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const bar = (pct) => "█".repeat(Math.round(pct / 10)).padEnd(10, "·");

const needGroup = (ctx) =>
    ctx.isGroup() ? null : ctx.format.info("(｡•́︿•̀｡) Command ni cuma dalam grup ya~");

const needPool = (ctx, pool, n) =>
    pool.length >= n ? null : ctx.format.info(
        `(｡･ω･｡) Kena ada sekurang-kurangnya ${n} ahli.\n♡ Sekarang: ${pool.length}`
    );

// ---- .gay : harmless percentage ------------------------------------------
// Deliberately silly and NOT a judgement about anyone's identity, so the copy
// stays a joke about the command, not the person.
function gayPct(id) {
    const key = String(id) + "|" + new Date().toDateString();
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return h % 101;
}

// ---- .rate : generic rater ------------------------------------------------
const RATE_VERDICTS = [
    "boleh tahan 😐", "okay je 🙂", "power sikit 😎", "gempak 🔥", "legend 🏆"
];

// ---- .truth / .dare ------------------------------------------------------
const TRUTHS = [
    "Benda paling memalukan yang kau pernah buat dalam grup ni?",
    "Siapa dalam grup ni kau paling tak nak bergaduh dengan?",
    "Berapa kali kau buka WhatsApp hari ni? Jujur.",
    "Apa benda yang kau menyesal beli bulan ni?",
    "Kalau kau kena kick satu orang dari grup ni, siapa?",
    "Cerita satu rahsia yang belum kau bagitahu sesiapa sini."
];

const DARES = [
    "Hantar satu sticker yang paling tak relevan sekarang.",
    "Taip nama kau guna emoji je, takde huruf.",
    "Reply mesej terakhir dalam grup ni dengan 'aku setuju'.",
    "Hantar voice note 3 saat gelak.",
    "Like mesej paling lama yang kau boleh scroll.",
    "Tukar profil WhatsApp kau 10 minit. Sekarang."
];

// ---- .roast --------------------------------------------------------------
// Targets the joke at the situation, never at appearance/identity/family.
const ROASTS = [
    "kau ni macam WiFi — kadang ada, kadang takde, tapi semua orang harap kau ada.",
    "kau ni macam update iOS — semua orang tunggu, lepas tu semua menyumpah.",
    "idea kau bagus, cuma timing dia macam iklan YouTube tak boleh skip.",
    "kau rajin sebenarnya, cuma rajin cari alasan.",
    "kau bukan slow, kau cuma buat orang tunggu dengan penuh emosi.",
    "kau ni macam backup phone — penting, tapi orang baru sedar bila hilang."
];

module.exports = [
    // .truth / .dare — group ice breakers
    {
        name: "truth",
        aliases: ["jujur"],
        category: "game",
        description: "Soalan truth untuk grup",
        cooldown: 6,
        code: async (ctx) => {
            const g = needGroup(ctx);
            if (g) return await ctx.reply(g);
            return await ctx.reply(ctx.format.info(`❖ *Truth* 🤔\n\n${pick(TRUTHS)}`));
        }
    },
    {
        name: "dare",
        aliases: ["cabaran"],
        category: "game",
        description: "Cabaran dare untuk grup",
        cooldown: 6,
        code: async (ctx) => {
            const g = needGroup(ctx);
            if (g) return await ctx.reply(g);
            return await ctx.reply(ctx.format.info(`❖ *Dare* 😈\n\n${pick(DARES)}\n\n♡ Tak buat = belanja semua orang 🙃`));
        }
    },

    // .gay — silly percentage, same shape as .ship
    {
        name: "gay",
        aliases: ["gayrate"],
        category: "game",
        description: "Peratusan lawak (tak serius)",
        cooldown: 6,
        code: async (ctx) => {
            const g = needGroup(ctx);
            if (g) return await ctx.reply(g);

            let pool;
            try { pool = await groupPool(ctx); } catch (e) {
                return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Gagal baca ahli: ${e.message}`));
            }
            if (!pool.length) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Takde ahli untuk dinilai."));

            // Rate a mention if given, else a random member.
            const mentioned = ctx.msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const target = mentioned.length
                ? pool.find((r) => ctx.helper.areJidsSameUser(r.id, mentioned[0])) || null
                : pick(pool);
            if (!target) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Orang tu bukan ahli grup ni."));

            const pct = gayPct(target.id);
            return await ctx.reply({
                text: `❖ *${pct}%* 🏳️‍🌈\n♡ @${ctx.getId(target.id)}\n\n♡ ${bar(pct)} ${pct}%\n\n_(lawak je, jangan ambil hati)_`,
                mentions: [target.id]
            });
        }
    },

    // .rate — rate a person, an object, whatever
    {
        name: "rate",
        aliases: ["nilai"],
        category: "game",
        description: "Bagi rating pada sesuatu/sesiapa",
        cooldown: 5,
        code: async (ctx) => {
            const subject = String(ctx.text || "").trim();
            if (!subject) {
                const p = ctx.used?.prefix || ".";
                return await ctx.reply(ctx.format.info(
                    `(｡•́︿•̀｡) Nak rate apa?\n\n♡ ${p}rate nasik lemak\n♡ ${p}rate @kawan`
                ));
            }

            // Deterministic per subject+day so the same thing doesn't swing wildly.
            const key = subject.toLowerCase() + "|" + new Date().toDateString();
            let h = 0;
            for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;

            const pct = h % 101;
            const verdict = RATE_VERDICTS[Math.min(RATE_VERDICTS.length - 1, Math.floor(pct / 20))];
            const stars = "★".repeat(Math.round(pct / 20)) + "☆".repeat(5 - Math.round(pct / 20));

            return await ctx.reply(ctx.format.info(
                `❖ *Rating* — ${subject.slice(0, 40)}\n\n` +
                `♡ ${stars}\n♡ ${pct}/100 — ${verdict}`
            ));
        }
    },

    // .roast — roast a member
    {
        name: "roast",
        aliases: ["sindir"],
        category: "game",
        description: "Sindir ahli grup (lawak)",
        cooldown: 8,
        code: async (ctx) => {
            const g = needGroup(ctx);
            if (g) return await ctx.reply(g);

            let pool;
            try { pool = await groupPool(ctx); } catch (e) {
                return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Gagal baca ahli: ${e.message}`));
            }
            if (!pool.length) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Takde ahli untuk disindir."));

            const mentioned = ctx.msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const target = mentioned.length
                ? pool.find((r) => ctx.helper.areJidsSameUser(r.id, mentioned[0])) || null
                : pick(pool);
            if (!target) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Orang tu bukan ahli grup ni."));

            return await ctx.reply({
                text: `❖ *Sindiran* 🔥\n\n♡ @${ctx.getId(target.id)}\n\n${pick(ROASTS)}\n\n_(lawak je bro, jangan sentap)_`,
                mentions: [target.id]
            });
        }
    },

    // .pick — let the bot choose between options
    {
        name: "pick",
        aliases: ["pilih", "undi"],
        category: "game",
        description: "Pilih satu dari senarai pilihan",
        cooldown: 4,
        code: async (ctx) => {
            const raw = String(ctx.text || "").trim();
            if (!raw) {
                const p = ctx.used?.prefix || ".";
                return await ctx.reply(ctx.format.info(
                    `(｡•́︿•̀｡) Bagi pilihan.\n\n♡ ${p}pick nasik lemak, mee goreng, roti canai`
                ));
            }

            // Split on comma, pipe, or the Malay/English "atau"/"or".
            const parts = raw
                .split(/\s*[,|]\s*|\s+(?:atau|or)\s+/i)
                .map((s) => s.trim())
                .filter(Boolean);

            if (parts.length < 2) {
                return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Bagi sekurang-kurangnya 2 pilihan, asingkan dengan koma."));
            }

            const chosen = pick(parts);
            return await ctx.reply(ctx.format.info(
                `❖ *Aku pilih*…\n\n♡ *${chosen.slice(0, 60)}*\n\n♡ (dari ${parts.length} pilihan)`
            ));
        }
    }
];
