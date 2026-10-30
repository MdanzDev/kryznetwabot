// roast-mode.js — Alya occasionally roasts a random member of the group.
//
// This is the ONLY place in the bot that burns an AI call unprompted, so the
// guards matter more than the feature:
//   - opt-in per chat via `.aiconfig roast` (off by default)
//   - groups only, never a DM
//   - at most one roast per ROAST_COOLDOWN_MS per chat
//   - needs >= MIN_MEMBERS humans, so it cannot single someone out in a tiny chat
//   - the model is told to be playful, never about appearance/identity/family,
//     and the reply is length-capped before it can become a paragraph
//
// Failure is silent: a roast is a garnish, it must never break a conversation.
"use strict";
const ROAST_COOLDOWN_MS = 30 * 60 * 1000;   // 30 min per chat
const MIN_MEMBERS = 3;                       // don't isolate someone in a duo
const MAX_LEN = 220;                         // hard cap on the model's output

const cooldowns = new Map();                 // chatId -> last roast ts
const inFlight = new Set();                  // chatIds currently roasting

const ROAST_SYSTEM = [
    "Kau Alya, bot WhatsApp dalam grup kawan-kawan Malaysia.",
    "Tugas kau: sindir seorang ahli grup dengan lawak, pendek, santai.",
    "PERATURAN KERAS:",
    "- Sasarkan GURAUAN SITUASI (rajin cakap, suka lambat, selalu online), BUKAN rupa, badan, agama, bangsa, keluarga, atau identiti.",
    "- Jangan maki hamun, jangan lucah, jangan ancam.",
    "- Maksimum 2 ayat. Bahasa Melayu santai macam sembang WhatsApp.",
    "- Jangan guna emoji lebih daripada 2.",
    "Balas HANYA dengan ayat sindiran. Tiada pembuka, tiada penerangan."
].join("\n");

/**
 * Decide whether this message should trigger a roast, and if so produce the text.
 * @returns {Promise<{text:string,target:object}|null>} roast, or null when not applicable
 */
async function maybeRoast({ ctx, wa, autoAi, pool }) {
    try {
        if (!ctx.isGroup()) return null;                       // never in DMs
        if (!autoAi.isRoastEnabled(ctx.id)) return null;       // opt-in only
        if (!pool || pool.length < MIN_MEMBERS) return null;   // no isolating in small groups

        const last = cooldowns.get(ctx.id) || 0;
        if (Date.now() - last < ROAST_COOLDOWN_MS) return null; // rate limit
        if (inFlight.has(ctx.id)) return null;                 // no overlapping calls

        const ai = wa?.tg?.ai;
        if (!ai?.chatWithFallback) return null;

        inFlight.add(ctx.id);
        try {
            const target = pool[Math.floor(Math.random() * pool.length)];
            const name = String(target.name || "kawan").slice(0, 24);

            const r = await ai.chatWithFallback("cheap", [
                { role: "system", content: ROAST_SYSTEM },
                {
                    role: "user",
                    content: `Sindir "${name}" secara lawak. Situasi je, jangan sentuh rupa/identiti/keluarga.`
                }
            ], { maxTokens: 120, timeoutMs: 20000 });

            let text = String(r?.reply || "").trim();
            if (!text) return null;

            // Strip any name-labelling the model adds, then cap the length.
            text = text.replace(/^["'`]|["'`]$/g, "").trim();
            if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN).replace(/\s+\S*$/, "") + "…";

            // Refuse outright if the model ignored the identity rule. Cheap
            // word check rather than trusting the prompt.
            if (/\b(gemuk|kurus|hodoh|buruk|miskin|bangsat|anjing|babi|kapir|kafir)\b/i.test(text)) {
                console.log("[roast] suppressed: output looked abusive");
                return null;
            }

            cooldowns.set(ctx.id, Date.now());
            return { text, target };
        } finally {
            inFlight.delete(ctx.id);
        }
    } catch (e) {
        console.log(`[roast] skipped: ${e.message}`);
        return null;
    }
}

function resetState() {
    cooldowns.clear();
    inFlight.clear();
}

module.exports = { maybeRoast, ROAST_COOLDOWN_MS, MIN_MEMBERS, MAX_LEN, resetState };
