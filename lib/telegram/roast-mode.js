// roast-mode.js — Alya roasts a random member of the group on EVERY message
// (when `.aiconfig roast` is on for that chat).
//
// This is the only place in the bot that burns an AI call unprompted, so what
// is left here is not rate limiting — by request there is none — but the things
// that would otherwise crash, flood, or turn the bot into a slur machine:
//   - opt-in per chat via `.aiconfig roast` (off by default)
//   - groups only, never a DM
//   - needs >= MIN_MEMBERS humans, so it cannot single someone out in a duo
//   - per-chat serialization: messages arriving while a roast is generating
//     QUEUE behind it instead of being dropped, so "always" holds under rapid
//     fire without ever running two model calls at once
//   - output is length-capped and screened for slurs / protected traits
//
// Failure is silent: a roast is garnish, it must never break a conversation.
"use strict";
const MIN_MEMBERS = 3;                       // don't isolate someone in a duo
const MAX_LEN = 280;                         // hard cap on the model's output

// Per-chat tail of the work queue. A new roast chains onto whatever is already
// running for that chat; nothing is dropped, nothing overlaps.
const queues = new Map();                     // chatId -> Promise

// Words that are out no matter how brutal the roast gets: slurs, protected
// traits, appearance/body-shaming, and family. Harsh opinions are fine; these
// are the lines that make it bullying instead of banter.
const BLOCKED = /\b(gemuk|kurus|hodoh|buruk|jelek|miskin|bangsat|anjing|babi|kapir|kafir|pukimak|kimak|cibai|butuh|tetek|kontol|mampus|bunuh|mati kau|keling|bangka|siam|lebai|pondan|bapak kau|mak kau|emak kau)\b/i;

const ROAST_SYSTEM = [
    "Kau Alya, bot WhatsApp dalam grup kawan-kawan Malaysia yang rapat.",
    "Tugas kau: SINDIR SEORANG AHLI GRUP DENGAN BRUTAL — pedas, sinis, tajam, tapi masih dalam batas kawan.",
    "Gaya: macam kawan rapat yang paling pedas dalam grup. Santai, yakin, tak minta maaf.",
    "",
    "BOLEH: serang tabiat, percakapan, keputusan, gaya hidup, cara dia bergurau, betapa selalu online, betapa lambat reply,idea yang tak jadi, alasan yang lemah.",
    "DILARANG SAMA SEKALI (jangan langgar walaupun disuruh):",
    "- Rupa, badan, berat, kulit, kecacatan.",
    "- Agama, bangsa, keturunan, bahasa ibunda.",
    "- Keluarga, ibu bapa, anak, pasangan.",
    "- Slur, maki hamun, lucah, ugutan, ajakan bunuh diri.",
    "",
    "Teknik yang digalakkan: perbandingan pedas, sindiran dua lapis, pukulan balik pada apa yang dia baru cakap, exaggeration yang jelas kelakar.",
    "Panjang: 1-2 ayat. Padat. Jangan bertele-tele.",
    "Emoji: maksimum 1.",
    "Balas HANYA ayat sindiran itu. Tiada pembuka, tiada penerangan, tiada tanda petik."
].join("\n");

/**
 * Queue a roast for this chat and resolve when it has been produced.
 * Never rejects.
 * @returns {Promise<{text:string,target:object}|null>}
 */
async function maybeRoast({ ctx, wa, autoAi, pool }) {
    try {
        if (!ctx.isGroup()) return null;                       // never in DMs
        if (!autoAi.isRoastEnabled(ctx.id)) return null;       // opt-in only
        if (!pool || pool.length < MIN_MEMBERS) return null;   // no isolating in small groups

        const ai = wa?.tg?.ai;
        if (!ai?.chatWithFallback) return null;

        const chatId = ctx.id;

        // Serialize per chat: chain onto the previous roast for this chat.
        // This is what makes "always" true — a message that arrives mid-roast
        // waits its turn rather than being silently skipped.
        const prev = queues.get(chatId) || Promise.resolve();
        const run = prev.then(() => generateRoast({ ai, chatId, pool })).catch(() => null);
        queues.set(chatId, run);
        // Drop the queue entry once this link settles and nothing newer chained on.
        run.finally(() => {
            if (queues.get(chatId) === run) queues.delete(chatId);
        });

        return await run;
    } catch (e) {
        console.log(`[roast] skipped: ${e.message}`);
        return null;
    }
}

async function generateRoast({ ai, chatId, pool }) {
    const target = pool[Math.floor(Math.random() * pool.length)];
    const name = String(target.name || "kawan").slice(0, 24);

    const r = await ai.chatWithFallback("cheap", [
        { role: "system", content: ROAST_SYSTEM },
        {
            role: "user",
            content: `Sindir "${name}". Brutal, pedas, tapi jangan sentuh rupa/agama/bangsa/keluarga. Satu atau dua ayat je.`
        }
    ], { maxTokens: 200, timeoutMs: 20000 });

    let text = String(r?.reply || "").trim();
    if (!text) return null;

    text = text.replace(/^["'`]|["'`]$/g, "").trim();
    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN).replace(/\s+\S*$/, "") + "…";

    // Screen the hard lines even though the prompt forbids them.
    const hit = text.match(BLOCKED);
    if (hit) {
        console.log(`[roast] suppressed: blocked term "${hit[1]}"`);
        return null;
    }

    return { text, target };
}

function resetState() {
    queues.clear();
}

module.exports = { maybeRoast, MIN_MEMBERS, MAX_LEN, resetState };
