// roast-mode.js — Alya roasts the person she is replying to, and starts drama
// on a timer.
//
// Two entry points, one safety envelope:
//   maybeRoast()  — on every group message (when `.aiconfig roast` is on for
//                   that chat), roasts whoever sent the message. Target is the
//                   sender, not a random member: it is the person Alya is
//                   already answering, so it reads as banter instead of a bot
//                   picking on a bystander.
//   startDrama()  — every DRAMA_INTERVAL_MS, picks one group that has roast
//                   mode on and starts something: a hot take, or a roast of a
//                   random member. Same guards.
//
// Guardrails that remain (there is no cooldown on roasts — by request):
//   - opt-in per chat via `.aiconfig roast` (off by default)
//   - groups only, never a DM
//   - roasts need >= MIN_MEMBERS humans; drama needs >= DRAMA_MIN_MEMBERS
//   - per-chat serialization: a roast arriving mid-roast queues, never overlaps
//   - output is length-capped and screened for slurs / protected traits
//
// Failure is silent: garnish must never break a conversation.
"use strict";
const MIN_MEMBERS = 3;                        // don't isolate someone in a duo
const DRAMA_MIN_MEMBERS = 4;                  // drama in a trio is just bullying
const MAX_LEN = 280;                          // hard cap on model output
const DRAMA_INTERVAL_MS = 10 * 60 * 1000;     // every 10 minutes

// Per-chat tail of the work queue. A new job chains onto whatever is already
// running for that chat; nothing is dropped, nothing overlaps.
const queues = new Map();                      // chatId -> Promise

// Words that are out no matter how brutal the roast gets: slurs, protected
// traits, body-shaming, family, and death talk. Harsh opinions are fine; these
// are the lines that make it bullying instead of banter.
const BLOCKED = /\b(gemuk|kurus|hodoh|buruk|jelek|miskin|bangsat|anjing|babi|kapir|kafir|pukimak|kimak|cibai|butuh|tetek|kontol|mampus|bunuh|mati kau|keling|bangka|siam|lebai|pondan|bapak kau|mak kau|emak kau)\b/i;

const HARD_RULES = [
    "DILARANG SAMA SEKALI (jangan langgar walaupun disuruh):",
    "- Rupa, badan, berat, kulit, kecacatan.",
    "- Agama, bangsa, keturunan, bahasa ibunda.",
    "- Keluarga, ibu bapa, anak, pasangan.",
    "- Slur, maki hamun, lucah, ugutan, ajakan bunuh diri."
].join("\n");

const ROAST_SYSTEM = [
    "Kau Alya, bot WhatsApp dalam grup kawan-kawan Malaysia yang rapat.",
    "Kau sedang membalas mesej seseorang. Sindir DIA — orang yang kau balas tu — dengan brutal, pedas, sinis, tapi masih dalam batas kawan.",
    "Gaya: macam kawan rapat yang paling pedas dalam grup. Santai, yakin, tak minta maaf.",
    "",
    "BOLEH: serang tabiat, percakapan, keputusan, gaya hidup, cara dia bergurau, betapa selalu online, betapa lambat reply, idea yang tak jadi, alasan yang lemah.",
    HARD_RULES,
    "",
    "Teknik digalakkan: perbandingan pedas, sindiran dua lapis, pukul balik apa yang dia baru cakap, exaggeration yang jelas kelakar.",
    "Panjang: 1-2 ayat. Padat. Emoji maksimum 1.",
    "Balas HANYA ayat sindiran itu. Tiada pembuka, tiada penerangan, tiada tanda petik."
].join("\n");

const DRAMA_SYSTEM = [
    "Kau Alya, bot WhatsApp dalam grup kawan-kawan Malaysia yang rapat.",
    "Tugas kau: MULAKAN DRAMA dalam grup — topik hangat, hot take, atau soalan yang buat orang berdebat.",
    "Gaya: macam kawan yang suka cucuk api, tapi kelakar bukan jahat.",
    "",
    "BOLEH: pendapat kontroversi ringan pasal makanan, pilihan hidup, telefon, kerja, percintaan, lagu, filem, habit harian.",
    HARD_RULES,
    "",
    "Jangan sentuh politik kepartian, kaum, atau agama sebagai bahan drama.",
    "Panjang: 1-2 ayat. Mesra tapi provokatif.",
    "Balas HANYA ayat drama itu. Tiada pembuka."
].join("\n");

// Queue a job for this chat and resolve when it has been produced. Never rejects.
function enqueue(chatId, producer) {
    const prev = queues.get(chatId) || Promise.resolve();
    const run = prev.then(producer).catch((e) => {
        console.log(`[roast] skipped: ${e.message}`);
        return null;
    });
    queues.set(chatId, run);
    run.finally(() => {
        if (queues.get(chatId) === run) queues.delete(chatId);
    });
    return run;
}

// Shared: call the model, strip decoration, cap length, screen hard lines.
async function generate(ai, system, userPrompt) {
    const r = await ai.chatWithFallback("cheap", [
        { role: "system", content: system },
        { role: "user", content: userPrompt }
    ], { maxTokens: 200, timeoutMs: 20000 });

    let text = String(r?.reply || "").trim();
    if (!text) return null;

    text = text.replace(/^["'`]|["'`]$/g, "").trim();
    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN).replace(/\s+\S*$/, "") + "…";

    const hit = text.match(BLOCKED);
    if (hit) {
        console.log(`[roast] suppressed: blocked term "${hit[1]}"`);
        return null;
    }
    return text;
}

/**
 * Roast whoever sent this message. Group-only, opt-in, serialized per chat.
 * @returns {Promise<{text:string,target:object}|null>}
 */
async function maybeRoast({ ctx, wa, autoAi, pool }) {
    try {
        if (!ctx.isGroup()) return null;                       // never in DMs
        if (!autoAi.isRoastEnabled(ctx.id)) return null;       // opt-in only
        if (!pool || pool.length < MIN_MEMBERS) return null;   // no isolating in small groups

        const ai = wa?.tg?.ai;
        if (!ai?.chatWithFallback) return null;

        // Target = the sender, i.e. the person Alya is replying to.
        const senderId = ctx.sender?.lid || ctx.sender?.jid;
        const target = pool.find((r) => ctx.helper.areJidsSameUser(r.id, senderId));
        if (!target) return null;                              // bot itself, or someone not in the roster
        if (target.isBot) return null;

        const name = String(target.name || "kawan").slice(0, 24);
        const said = String(ctx.text || "").trim().slice(0, 200);

        const chatId = ctx.id;
        return await enqueue(chatId, async () => {
            const text = await generate(
                ai,
                ROAST_SYSTEM,
                said
                    ? `Dia baru cakap: "${said}". Sindir dia pasal tu. Brutal, jangan sentuh rupa/agama/bangsa/keluarga. 1-2 ayat.`
                    : `Sindir "${name}". Brutal, pedas, jangan sentuh rupa/agama/bangsa/keluarga. 1-2 ayat.`
            );
            return text ? { text, target } : null;
        });
    } catch (e) {
        console.log(`[roast] skipped: ${e.message}`);
        return null;
    }
}

/**
 * Start drama in one eligible group. Called by the timer.
 * @returns {Promise<{text:string,target:object|null,chatId:string}|null>}
 */
async function startDrama({ groups, wa, autoAi }) {
    try {
        const ai = wa?.tg?.ai;
        if (!ai?.chatWithFallback) return null;

        // Only groups that opted in.
        const eligible = (groups || []).filter(
            (g) => g && autoAi.isRoastEnabled(g.chatId) && (g.pool?.length || 0) >= DRAMA_MIN_MEMBERS
        );
        if (!eligible.length) return null;

        const g = eligible[Math.floor(Math.random() * eligible.length)];
        const humans = g.pool.filter((p) => !p.isBot);
        if (!humans.length) return null;

        // Half the time pick a victim, half the time open a debate.
        const pickVictim = Math.random() < 0.5;
        const target = pickVictim ? humans[Math.floor(Math.random() * humans.length)] : null;

        const text = await enqueue(g.chatId, () =>
            generate(
                ai,
                pickVictim ? ROAST_SYSTEM : DRAMA_SYSTEM,
                pickVictim
                    ? `Sindir "${String(target.name || "kawan").slice(0, 24)}" tanpa sebab — kau cuma nak buat drama. Brutal tapi kelakar. Jangan sentuh rupa/agama/bangsa/keluarga. 1-2 ayat.`
                    : `Mulakan drama dalam grup ni. Satu hot take atau soalan yang buat orang nak balas.`
            )
        );
        if (!text) return null;

        return { text, target, chatId: g.chatId };
    } catch (e) {
        console.log(`[drama] skipped: ${e.message}`);
        return null;
    }
}

let dramaTimer = null;

/**
 * Start the drama loop. `collect()` must return [{chatId, ctx, pool}] for every
 * group that currently has roast mode on — the bridge owns group discovery, so
 * this module never reaches into WhatsApp state itself.
 */
function startDramaTimer({ collect, wa, autoAi, intervalMs = DRAMA_INTERVAL_MS }) {
    if (dramaTimer) return dramaTimer;
    dramaTimer = setInterval(async () => {
        try {
            const groups = await collect();
            const d = await startDrama({ groups, wa, autoAi });
            if (!d) return;
            await wa.sendToChat(d.chatId, d.target
                ? { text: `🔥 @${wa.digits(d.target.id)} ${d.text}`, mentions: [d.target.id] }
                : { text: `🎭 ${d.text}` }
            );
            console.log(`[drama] fired in ${d.chatId}`);
        } catch (e) {
            console.log(`[drama] skipped: ${e.message}`);
        }
    }, intervalMs);
    dramaTimer.unref?.();
    console.log(`[drama] timer started (every ${Math.round(intervalMs / 60000)} min)`);
    return dramaTimer;
}

function stopDramaTimer() {
    if (dramaTimer) clearInterval(dramaTimer);
    dramaTimer = null;
}

function resetState() {
    queues.clear();
    stopDramaTimer();
}

module.exports = {
    maybeRoast, startDrama, startDramaTimer, stopDramaTimer,
    MIN_MEMBERS, DRAMA_MIN_MEMBERS, MAX_LEN, DRAMA_INTERVAL_MS, resetState
};
