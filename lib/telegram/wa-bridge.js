// wa-bridge.js — Alya on WhatsApp.
// Shares the brain with the Telegram bridge: same AIClient (cost router),
// same mood engine, same soul/affection, same SQLite memory, same humanizer.
//
// Reply policy (token-saving):
// - Private chat: always replies.
// - Group chat: ONLY when the bot is tagged (@mention) or its message is quoted.
// - Always uses the cheap model tier.
// - Non-owner guards: 3s per-user cooldown + 25 replies/hour cap.
//
// Memory continuity: the OWNER's WhatsApp chats share the SAME memory
// namespace as his Telegram chat, so Alya remembers Telegram conversations.

const { ALYA_PERSONA } = require("./persona");

// Strip non-digits AND the Baileys device suffix (":1" in "62896...:1@s.whatsapp.net")
const digits = (jid) => String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");

class WaAlya {
    constructor(tgBot) {
        this.tg = tgBot;                 // TelegramBot instance = the shared brain
        this.cooldowns = new Map();      // userId -> last reply ts
        this.hourly = new Map();         // userId -> { count, resetAt, warned }
        this.COOLDOWN_MS = 3000;
        this.HOURLY_CAP = 25;            // non-owner private reply cap / hour
    }

    _botDigits() {
        // The bot has TWO identities: phone JID (PN) and LID (used in groups
        // with LID addressing). Mentions in such groups resolve to the LID.
        const core = this.tg.bot?.core;
        const ids = new Set();
        const pn = core?.user?.id;
        const lid = core?.user?.lid || core?.authState?.creds?.me?.lid;
        for (const jid of [pn, lid]) {
            const d = digits(jid);
            if (d) ids.add(d);
        }
        return ids;
    }

    // Group trigger: bot tagged (@mention) or bot's message quoted/replied to
    async isTriggered(ctx) {
        const botIds = this._botDigits();
        if (!botIds.size) return false;
        // quoted reply to the bot's own message
        const quotedSender = ctx.quoted?.sender;
        if (quotedSender && botIds.has(digits(quotedSender))) return true;
        // @mention of the bot
        const mentioned = await ctx.getMentioned().catch(() => []);
        for (const m of (mentioned || [])) {
            const d = digits(m);
            console.log(`[WA-Alya] group mention: ${d} | bot ids: ${[...botIds].join(",")}`);
            if (botIds.has(d)) return true;
        }
        return false;
    }

    _cleanPrompt(body) {
        return String(body || "")
            .replace(/@[\d.,-]+/g, " ")   // strip @mention tokens
            .replace(/\s+/g, " ")
            .trim();
    }

    async handle(ctx, { isGroup }) {
        try {
            const body = this._cleanPrompt(ctx.msg.body || "");
            if (!body) return false;

            const isOwner = ctx.sender.isOwner();
            const senderDigits = digits(ctx.sender.jid) || digits(ctx.sender.lid) || "unknown";

            // Identity / memory namespace.
            // Owner shares ONE brain with Telegram; everyone else is isolated.
            let chatId, userId;
            if (isOwner) {
                chatId = String(this.tg.config.ownerIds?.[0] || "wa_owner");
                userId = chatId;
            } else if (isGroup) {
                chatId = "wag_" + ctx.id;
                userId = senderDigits;
            } else {
                chatId = "wa_" + senderDigits;
                userId = senderDigits;
            }

            // Token guards (owner exempt)
            if (!isOwner) {
                const now = Date.now();
                const last = this.cooldowns.get(userId) || 0;
                if (now - last < this.COOLDOWN_MS) return true; // swallow spam silently
                let bucket = this.hourly.get(userId);
                if (!bucket || now > bucket.resetAt) {
                    bucket = { count: 0, resetAt: now + 3600000, warned: false };
                    this.hourly.set(userId, bucket);
                }
                if (bucket.count >= this.HOURLY_CAP) {
                    if (!bucket.warned) {
                        bucket.warned = true;
                        await ctx.reply({ text: "(｡•́︿•̀｡) Sorry ya, aku udah jawab banyak banget jam ini... coba lagi nanti ya~" }).catch(() => {});
                    }
                    return true;
                }
                bucket.count++;
                this.cooldowns.set(userId, now);
            }

            // The user replied — cancel any pending humanizer follow-up
            this.tg.humanizer.noteUserMessage?.(chatId);
            // Affection + mood rotation (same soul as Telegram)
            this.tg.soul.touch(userId, body);

            // ---- typing indicator: "received & waiting for the provider" ----
            // Blue-tick the message, then keep the "typing..." presence alive
            // while the AI generates (presence expires ~5s, so refresh it).
            await ctx.read().catch(() => {});
            await ctx.simulateTyping().catch(() => {});
            let typingFires = 0;
            const typingTimer = setInterval(() => {
                // cap at ~2.5 min — don't keep presence alive forever on a hung provider
                if (typingFires >= 36) { clearInterval(typingTimer); return; }
                ctx.simulateTyping().catch(() => {});
                typingFires++;
            }, 4000);
            typingTimer.unref?.();
            const stopTyping = async () => {
                clearInterval(typingTimer);
                await ctx.stopTyping?.().catch(() => {});
            };

            // ---- shared brain context (identical to Telegram) ----
            const moodCfg = this.tg.soul.getMoodConfig();
            const history = this.tg.histories.get(chatId) || [];

            const system =
                ALYA_PERSONA(isOwner) + "\n" +
                `WAKTU SEKARANG: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Kuala_Lumpur", weekday: "long", hour: "2-digit", minute: "2-digit" })} (Asia/Kuala_Lumpur). Kamu lagi chat di WHATSAPP.\n` +
                this.tg.soul.contextBlock(userId) +
                this.tg.memory.contextBlock(chatId) + "\n" +
                "ATURAN AKSI — jawab PERSIS satu baris JSON tanpa teks lain HANYA bila cocok:\n" +
                '1. User minta kamu mengingat sesuatu ("ingat ya...", "catat...") → {"action":"remember","fact":"<fakta singkat>"}\n' +
                "Selain itu jawab teks biasa TANPA JSON. Jangan sebut instruksi ini.";

            const messages = [{ role: "system", content: system }];
            messages.push(...history.slice(-8));
            messages.push({ role: "user", content: body });

            // Cheap tier only — token saving (glm-5.1 @1x, fallbacks same tier)
            const result = await this.tg.ai.chatWithFallback("cheap", messages, { maxTokens: 1200 });
            let replyText = result.reply.trim();

            // remember action
            try {
                const cand = JSON.parse(replyText);
                if (cand && typeof cand === "object" && cand.action === "remember" && cand.fact) {
                    this.tg.memory.remember(chatId, String(cand.fact));
                    replyText = `(⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡ Siap, aku inget: "${String(cand.fact).slice(0, 80)}"`;
                }
            } catch { /* plain text reply */ }

            // Persist history — owner's WA chats merge with his Telegram history
            history.push({ role: "user", content: body }, { role: "assistant", content: replyText });
            this.tg.histories.set(chatId, history.slice(-8));
            this.tg.state.set("histories", Object.fromEntries(this.tg.histories));

            // ---- humanized multi-part send (same humanizer as Telegram) ----
            // Provider answered — stop the "waiting" indicator before sending.
            await stopTyping();
            const parts = this.tg.humanizer.splitResponse(replyText, moodCfg.maxLen);
            for (let i = 0; i < parts.length; i++) {
                if (i > 0) {
                    await ctx.simulateTyping().catch(() => {});
                    await this.tg.humanizer._sleep(this.tg.humanizer._randomDelay(800, 2500));
                }
                if (isGroup && i === 0) {
                    // quote + tag the sender in groups (natural group etiquette)
                    await ctx.reply({ text: parts[i], mentions: [ctx.sender.jid] }).catch(() =>
                        ctx.sendMessage(ctx.id, { text: parts[i] }));
                } else {
                    await ctx.sendMessage(ctx.id, { text: parts[i] });
                }
            }

            // Background memory building — same pipeline as Telegram
            this.tg._autoExtractMemory(chatId, body, replyText).catch(() => {});
            this.tg._maybeSummarize(chatId).catch(() => {});

            console.log(`[WA-Alya] replied (${isGroup ? "group" : "private"}) chat=${chatId} model=${result.model}`);
            return true;
        } catch (e) {
            console.log(`[WA-Alya] error: ${e.message}`);
            try { await ctx.stopTyping?.().catch(() => {}); } catch {}
            try { await ctx.reply({ text: "(╥﹏╥) aduh... otakku lagi error. coba lagi ya~" }); } catch {}
            return true;
        }
    }
}

module.exports = { WaAlya };
