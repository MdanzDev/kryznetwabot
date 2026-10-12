// .kickidle — remove the least-active members.
//
// Two phases, deliberately:
//   1. `.kickidle [n]`        -> preview the exact list, change nothing
//   2. `.kickidle yes`        -> kick the members from that preview
//
// The two-phase shape is not decoration. A bulk remove is irreversible, it
// notifies everyone, and the candidate list depends on data that can shift
// between the preview and the action — so the preview is what gets executed,
// not a re-computed list.
//
// Ranking comes from lib/group-rank.js: authoritative member list from WhatsApp
// metadata, `sent` looked up per member (0 when never tracked). Admins and the
// bot are never candidates.
const rank = require("../../lib/group-rank");

// chatId -> { ids, names, groupJid, at }
const pendingKicks = new Map();

module.exports = {
    name: "kickidle",
    aliases: ["kicksepi", "kickdead", "buangsepi"],
    category: "group",
    permissions: {
        admin: true,
        botAdmin: true,
        group: true
    },
    code: async (ctx) => {
        const groupJid = ctx.id;
        const senderKey = String(ctx.sender.lid || ctx.sender.jid || "");

        // ---------- phase 2: confirm ----------
        const input = (ctx.text || "").trim().toLowerCase();
        if (rank.CONFIRM_WORDS.includes(input)) {
            const pending = pendingKicks.get(groupJid);
            if (!pending) {
                return await ctx.reply(ctx.format.info("Tiada senarai menunggu. Jalankan .kickidle dulu untuk lihat senarai."));
            }
            if (pending.by !== senderKey) {
                return await ctx.reply(ctx.format.info("Senarai ini dibuat oleh admin lain. Minta dia taip .kickidle yes."));
            }
            if (Date.now() - pending.at > rank.CONFIRM_WINDOW_MS) {
                pendingKicks.delete(groupJid);
                return await ctx.reply(ctx.format.info("Senarai dah luput (lebih 1 minit). Jalankan .kickidle semula."));
            }
            pendingKicks.delete(groupJid);
            return await executeKick(ctx, pending);
        }

        // ---------- phase 0: cancel ----------
        if (input === "cancel" || input === "batal") {
            if (pendingKicks.delete(groupJid)) {
                return await ctx.reply(ctx.format.info("Dibatalkan. Tiada sesiapa dikeluarkan."));
            }
            return await ctx.reply(ctx.format.info("Tiada senarai menunggu untuk dibatalkan."));
        }

        // ---------- phase 1: preview ----------
        const requested = parseInt(ctx.args[0], 10);
        const rows = await rank.buildRanking(ctx);
        const available = rows.filter(r => !r.isBot && !r.isAdmin);

        if (!available.length) {
            return await ctx.reply(ctx.format.info("Tiada ahli yang boleh dikeluarkan (semua admin atau tiada rekod)."));
        }

        const want = Number.isFinite(requested) && requested > 0 ? requested : rank.KICK_MAX_PER_RUN;
        const limit = Math.min(want, rank.KICK_MAX_PER_RUN);
        const candidates = rank.idleCandidates(rows, limit);

        if (!candidates.length) {
            return await ctx.reply(ctx.format.info("Tiada calon untuk dikeluarkan."));
        }

        pendingKicks.set(groupJid, {
            ids: candidates.map(c => c.id),
            names: candidates.map(c => c.name),
            groupJid,
            by: senderKey,
            at: Date.now()
        });

        const total = available.length;
        const capped = want > rank.KICK_MAX_PER_RUN;

        let text = "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝐒𝐄𝐍𝐀𝐑𝐀𝐈 𝐒𝐈𝐃𝐄𝐑𝐒  ♡⊹˚₊\n" +
            `│ (｡•́︿•̀｡) ${candidates.length} ahli paling sepi\n` +
            "╰───────────────୨୧\n\n" +
            "╭┈┈┈┈┈┈┈┈୨୧\n" +
            "┊ ✦ 𝐂𝐀𝐋𝐎𝐍 𝐃𝐈𝐁𝐔𝐀𝐍𝐆 ୨୧\n┊\n";
        candidates.forEach((c, i) => {
            text += `┊ ❖ ${c.name} — ${c.sent} pesan · sejak ${rank.ageLabel(c.firstSeen)}\n`;
        });
        text += "╰┈┈┈┈┈┈┈┈୨୧\n\n";
        text += "╭───────────────୨୧\n" +
            `│ ♡ Jumlah ahli boleh dikeluarkan: ${total}\n` +
            (capped ? `│ ♡ Had ${rank.KICK_MAX_PER_RUN} setiap kali (elak ban). Jalankan semula untuk teruskan.\n` : "") +
            "│ ♡ Admin & bot tidak akan dikeluarkan.\n" +
            "╰───────────────୨୧";

        await ctx.reply({
            text,
            footer: config.msg.footer,
            buttons: [
                { text: "♡ Ya, Keluarkan", id: `${ctx.used.prefix}kickidle yes` },
                { text: "୨୧ Batal", id: `${ctx.used.prefix}kickidle cancel` }
            ]
        });
    }
};

// ---------- execution ----------
async function executeKick(ctx, pending) {
    const group = ctx.group();
    const kicked = [];
    const failed = [];

    await ctx.reply(ctx.format.info(`Sedang mengeluarkan ${pending.ids.length} ahli...`));

    for (let i = 0; i < pending.ids.length; i += rank.KICK_BATCH_SIZE) {
        const batch = pending.ids.slice(i, i + rank.KICK_BATCH_SIZE);
        try {
            await group.kick(batch);
            kicked.push(...batch);
        } catch (error) {
            failed.push(...batch);
            console.error("[kickidle] batch failed:", error.message);
        }
        // Pause between batches: a tight loop of removes is what gets a number
        // rate-limited or banned.
        if (i + rank.KICK_BATCH_SIZE < pending.ids.length) await rank.sleep(rank.KICK_BATCH_DELAY_MS);
    }

    // Drop the kicked members from the tracked list so rankings stay honest.
    const tracked = ctx.db.group?.members || [];
    const kept = tracked.filter(m => !kicked.some(id => ctx.helper.areJidsSameUser(id, m.id)));
    if (kept.length !== tracked.length) {
        ctx.db.group.members = kept;
        ctx.db.group.save();
    }

    let text = "╭───────────────୨୧\n" +
        "│  ₊˚⊹♡  𝐒𝐈𝐀𝐏 𝐃𝐈𝐁𝐔𝐀𝐍𝐆  ♡⊹˚₊\n" +
        `│ (｡･ω･｡) ${kicked.length} ahli dikeluarkan\n` +
        "╰───────────────୨୧";
    if (failed.length) text += `\n\n(｡•́︿•̀｡) ${failed.length} gagal (mungkin admin atau nombor tak sah).`;
    return await ctx.reply(text);
}

module.exports.pendingKicks = pendingKicks;
