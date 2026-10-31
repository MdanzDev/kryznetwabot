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
// Context engine (wa-context.js):
// - Rapid messages from the SAME sender are debounced into ONE AI turn.
// - Groups keep a shared, bounded timeline (silently recorded, no AI call).
// - Quoted/replied WhatsApp messages are resolved and prioritised.
// - Tool/command/API failures become short-lived internal system events.
//
// Memory continuity: the OWNER's WhatsApp chats share the SAME memory
// namespace as his Telegram chat, so Alya remembers Telegram conversations.

const { ALYA_PERSONA } = require("./persona");
const { ChatQueue } = require("./chat-queue");
const tokenLimiter = require("./token-limiter");
const autoAi = require("../wa-autoai");
const {
    ContextStore, buildAIContext, CONTEXT_RULES, clip,
    AI_DEBOUNCE_MS, BATCH_MAX_WAIT_MS
} = require("./wa-context");

// Strip non-digits AND the Baileys device suffix (":1" in "62896...:1@s.whatsapp.net")
const digits = (jid) => String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");

// Messages that look like an explicit bot command skip the debounce wait.
const IMMEDIATE_RE = /^[.!\/#][a-z]{2,}\b/i;

// ╭───────────────୨୧
// │ UX HELPERS
// ╰───────────────୨୧

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const SEEN_REACTIONS   = ["👀", "✨", "💭", "🌸", "⚡", "🌙"];
const DONE_REACTIONS   = ["✅", "👍", "💫", "♡", "🎀"];
const VOICE_REACT      = "🎙️";

const SLOW_LINES = [
    "bentar ya, aku fikir dulu~",
    "sekejap eh ♡",
    "hmm... tgh fikir ni",
    "okay okay, tunggu jap ya"
];

const ERROR_LINES = [
    "aduh... otakku stuck jap 🙈 cuba lagi ya",
    "alamak, aku blur kejap 😵‍💫 tanya balik boleh?",
    "sorry, line aku kacau kejap... repeat boleh?"
];

const SLOW_AI_MS = 15000;   // send "bentar ya" if AI hasn't replied by then

// ---- capability block ------------------------------------------------------
// The persona describes HOW Alya talks; it says nothing about WHAT she can do.
// Without this, the model improvises an answer when asked for something the bot
// actually supports — it told a user "aku tak boleh main lagu, cuma boleh
// cari/suggest", which is false: `.play` exists and the `command` action below
// is NOT owner-gated, so a friend can already trigger it.
//
// This block is the single source of truth for capabilities. Anything listed
// here must correspond to a real command; keep it short so it does not crowd
// out the persona.
const CAPABILITIES_NOTE =
    "KEMAMPUAN KAU (INI FAKTA — jangan sekali-kali kata kau tak boleh buat benda dalam senarai ni):\n" +
    "- Hantar lagu/audio dari YouTube → command `play` (contoh args: \"animal katseye\")\n" +
    "- Hantar video dari YouTube → command `playvid`\n" +
    "- Lagu dari Spotify → command `spotifydl`\n" +
    "- Download TikTok / Instagram / Facebook / Pinterest → `tiktokdl` / `instagramdl` / `facebookdl` / `pinterestdl`\n" +
    "- Sticker dari gambar → command `sticker`\n" +
    "- Buat gambar AI → command `flux` atau `nanobanana`\n" +
    "- Cuaca, cari maklumat, terjemah, ringkaskan → jawab terus, tak perlu command\n" +
    "Kalau user minta lagu/video, JANGAN tanya banyak kali — teruskan niat dia (kalau dia dah bagi nama lagu, guna terus). " +
    "Kalau kau tak pasti command mana, tanya sekali je, jangan teka dan jangan mengaku kau tak mampu.\n" +
    "JANGAN sebut perkataan 'command' atau JSON dalam jawapan kau — user tak patut nampak mekanik ni.";


class WaAlya {
    constructor(tgBot) {
        this.tg = tgBot;                 // TelegramBot instance = the shared brain
        // Max 2 concurrent AI handlers. 3rd group waits in queue.
        // This prevents bubble interleaving across groups.
        this.queue = new ChatQueue(2);

        // ---- context engine state ----
        this.ctxStore = new ContextStore();
        this.buffers = new Map();        // "chatId|senderDigits" -> { entries, timer, firstTs, isGroup }
        this.chatTails = new Map();      // chatId -> promise tail (one AI generation per chat at a time)
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
        // @mention of the bot
        const mentioned = await ctx.getMentioned().catch(() => []);
        for (const m of (mentioned || [])) {
            const d = digits(m);
            console.log(`[WA-Alya] group mention: ${d} | bot ids: ${[...botIds].join(",")}`);
            if (botIds.has(d)) return true;
        }
        // quoted/replied to one of the bot's own messages
        const q = this._extractQuoted(ctx);
        if (q?.senderId && botIds.has(q.senderId)) {
            console.log(`[WA-Alya] group quote of bot message: ${q.senderId}`);
            return true;
        }
        return false;
    }

    _cleanPrompt(body) {
        return String(body || "")
            .replace(/@[\d.,-]+/g, " ")   // strip @mention tokens
            .replace(/\s+/g, " ")
            .trim();
    }

    // ================= CONTEXT ENGINE HELPERS =================

    // WhatsApp message id (standard Baileys: msg.key.id). null if unavailable.
    _msgId(ctx) {
        const m = ctx.msg;
        return m?.key?.id || m?.id || null;
    }

    _senderInfo(ctx) {
        const senderDigits = digits(ctx.sender?.jid) || digits(ctx.sender?.lid) || "unknown";
        const senderName = ctx.msg?.pushName || senderDigits;
        return { senderDigits, senderName };
    }

    // Standard Baileys: contextInfo lives inside message.<xxxMessage>.contextInfo,
    // possibly wrapped by ephemeral/viewOnce containers (.message).
    _findContextInfo(message, depth = 0) {
        if (!message || typeof message !== "object" || depth > 3) return null;
        for (const v of Object.values(message)) {
            if (!v || typeof v !== "object") continue;
            if (v.contextInfo && typeof v.contextInfo === "object") return v.contextInfo;
            if (v.message) {
                const r = this._findContextInfo(v.message, depth + 1);
                if (r) return r;
            }
        }
        return null;
    }

    _quotedText(qm) {
        if (!qm || typeof qm !== "object") return "";
        const m = qm.ephemeralMessage?.message || qm.viewOnceMessage?.message ||
                  qm.viewOnceMessageV2?.message || qm.documentWithCaptionMessage?.message || qm;
        if (m.conversation) return m.conversation;
        if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
        if (m.imageMessage) return `[gambar]${m.imageMessage.caption ? " " + m.imageMessage.caption : ""}`;
        if (m.videoMessage) return `[video]${m.videoMessage.caption ? " " + m.videoMessage.caption : ""}`;
        if (m.audioMessage) return "[voice note]";
        if (m.stickerMessage) return "[sticker]";
        if (m.documentMessage) return `[file: ${m.documentMessage.fileName || "dokumen"}]`;
        return "";
    }

    // { messageId, senderId, text } of the WhatsApp message being replied to, or null.
    _extractQuoted(ctx) {
        try {
            const ci = this._findContextInfo(ctx.msg?.message);
            if (!ci || !ci.stanzaId) return null;
            return {
                messageId: ci.stanzaId,
                senderId: digits(ci.participant),
                text: this._quotedText(ci.quotedMessage)
            };
        } catch { return null; }
    }

    // Cheap text for the timeline — NO media download / AI call here.
    _quickText(ctx) {
        const msg = ctx.msg || {};
        const caption = this._cleanPrompt(msg.body || "");
        if (caption) return caption;
        switch (msg.messageType) {
            case "imageMessage": return "[gambar]";
            case "audioMessage": return "[voice note]";
            case "stickerMessage": return "[sticker]";
            case "documentMessage": return "[file]";
            default: return "";
        }
    }

    // Humans present in this group, for roast mode. Same rule as .ship / fun.js:
    // authoritative roster, bot excluded, departed members excluded.
    async _roastPool(ctx) {
        try {
            const { buildRanking } = require("../group-rank");
            const rows = (await buildRanking(ctx)) || [];
            return rows.filter((r) => !r.isBot);
        } catch {
            return [];
        }
    }

    // Identity / memory namespace — the ONE place this is decided.
    //
    // Owner shares ONE brain with Telegram; everyone else is isolated.
    // `.relationship` (and anything else keyed by soul userId) must use the
    // same values, or it reports a stranger's stats.
    identityFor(ctx, isGroup = ctx.isGroup()) {
        const { senderDigits } = this._senderInfo(ctx);
        if (ctx.sender.isOwner()) {
            const chatId = String(this.tg.config.ownerIds?.[0] || "wa_owner");
            return { chatId, userId: chatId };
        }
        if (isGroup) return { chatId: "wag_" + ctx.id, userId: senderDigits };
        return { chatId: "wa_" + senderDigits, userId: senderDigits };
    }

    _record(ctx, senderDigits, senderName, text) {
        const q = this._extractQuoted(ctx);
        const rec = this.ctxStore.recordMessage(ctx.id, {
            senderId: senderDigits,
            senderName,
            text: clip(text, 600),
            timestamp: Date.now(),
            messageId: this._msgId(ctx),
            quotedMessageId: q?.messageId || null,
            isBot: false
        });
        // Mirror into the durable archive so .quote/.recap survive restarts.
        // Best-effort: history loss must never break message handling.
        try {
            this.tg?.store?.addChatLine("wag_" + ctx.id, {
                senderId: senderDigits,
                senderName,
                text
            });
        } catch (e) {
            console.log(`[WA-Context] archive failed: ${e.message}`);
        }
        return rec;
    }

    // PUBLIC: call this from the dispatcher for group messages that do NOT trigger
    // the bot. Records silently — never calls the AI.
    observeGroup(ctx) {
        try {
            const { senderDigits, senderName } = this._senderInfo(ctx);
            if (this._botDigits().has(senderDigits)) return; // bot's own messages are recorded on send
            const text = this._quickText(ctx);
            if (!text) return;
            if (IMMEDIATE_RE.test(text)) return; // bot commands (.mute, .unmute...) are not chatter
            this._record(ctx, senderDigits, senderName, text);
            console.log(`[WA-Context] group message recorded group=${String(ctx.id).split("@")[0].slice(-6)}`);
        } catch (e) {
            console.log(`[WA-Context] observe failed: ${e.message}`);
        }
    }

    // PUBLIC single entry point for GROUP messages. The dispatcher only needs:
    //     await waAlya.onGroupMessage(ctx);
    // Triggered (mention / quote of the bot) → AI turn. Otherwise → silent record.
    async onGroupMessage(ctx) {
        let triggered = false;
        try { triggered = await this.isTriggered(ctx); } catch { /* treat as not triggered */ }
        if (triggered) return this.handle(ctx, { isGroup: true });
        this.observeGroup(ctx);
        return false;
    }

    _recordBot(ctx, text, messageId = null) {
        try {
            this.ctxStore.recordMessage(ctx.id, {
                senderId: "bot", senderName: "Kryzz", text: clip(text, 600),
                timestamp: Date.now(), messageId, isBot: true, consumed: true
            });
            // Mirror into the durable archive as the BOT, so a later quote of
            // this message can be attributed to Alya instead of "seseorang".
            // Without this the bot reads its own words as a stranger's.
            this.tg?.store?.addChatLine("wag_" + ctx.id, {
                senderId: "bot",
                senderName: this.tg?.config?.botName || "Alya",
                text
            });
        } catch { /* best effort */ }
    }

    // True when the quoted message was sent by the bot itself.
    _quotedIsBot(quoted) {
        if (!quoted) return false;
        if (quoted.senderId && this._botDigits().has(quoted.senderId)) return true;
        // Our own archive stamps bot rows with senderId "bot".
        return quoted.senderId === "bot" || quoted.senderName === "bot";
    }

    // Record an INTERNAL event (never a fake user message).
    _event(ctx, type, source, message, opts = {}) {
        try {
            this.ctxStore.recordEvent(ctx.id, { type, source, message, ...opts });
            console.log(`[WA-Context] system event recorded type=${type} source=${source}`);
        } catch { /* best effort */ }
    }

    // ---- MEDIA: image / voice note / document handling ----
    // Returns { userContent, caption, hasImage, hasAudio } for the AI call.
    async _buildMediaContent(ctx) {
        const msg = ctx.msg;
        const type = msg.messageType || "";
        const caption = this._cleanPrompt(msg.body || "");
        const out = { userContent: null, caption, hasImage: false, hasAudio: false };

        // Image: TWO-STAGE pipeline (kimi sees, glm talks).
        // Stage 1: kimi-k3 (vision, 2x) describes the image factually — cheap, short.
        // Stage 2: the description becomes text for glm-5.1, which stays the
        // personality/chat brain. glm NEVER sees pixels.
        if (type === "imageMessage" || (type === "viewOnceMessageV2" && msg.message?.viewOnceMessageV2?.message?.imageMessage)) {
            try {
                const buffer = await ctx.msg.media.download();
                if (Buffer.isBuffer(buffer) && buffer.length > 100) {
                    out.hasImage = true;
                    // Immediate "saw it" reaction — user knows image was received
                    await ctx.react?.(ctx.id, "🖼️").catch(() => {});
                    const r = await this.tg.ai.chat("kimi-k3", [{
                        role: "user",
                        content: [
                            { type: "text", text: "Describe this image factually in 2-3 sentences: what/who is in it, notable details, any text visible. Neutral tone, no greetings, no emoji. This description will be given to another AI to chat about." },
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${buffer.toString("base64")}` } }
                        ]
                    }], { maxTokens: 300, timeoutMs: 60000 });
                    const desc = (r.content || "").trim();
                    if (desc) {
                        console.log(`[WA-Alya] image described (kimi-k3): ${desc.slice(0, 80)}`);
                        // Fold caption + description into ONE text prompt for glm
                        out.caption = (caption ? caption + "\n\n" : "") + `[Gambar yang user hantar]: ${desc}`;
                        out.imageDescription = desc;
                    } else {
                        out.caption = (caption ? caption + "\n\n" : "") + "[User hantar gambar tapi aku tak berjaya tengok isi dia]";
                    }
                }
            } catch (e) {
                console.log(`[WA-Alya] image pipeline failed: ${e.message}`);
                out.caption = (caption ? caption + "\n\n" : "") + "[User hantar gambar tapi aku tak berjaya tengok isi dia]";
            }
            return out;
        }

        // Voice note / audio: transcribe with kimi-k3, treat transcript as prompt
        if (type === "audioMessage") {
            try {
                const buffer = await ctx.msg.media.download();
                if (Buffer.isBuffer(buffer) && buffer.length > 1000) {
                    out.hasAudio = true;
                    // "listening" reaction — user sees the bot is processing the voice
                    await ctx.react?.(ctx.id, VOICE_REACT).catch(() => {});
                    const r = await this.tg.ai.chat("kimi-k3", [{
                        role: "user",
                        content: [
                            { type: "text", text: "Transcribe this voice message exactly. Reply with ONLY the transcript, no commentary." },
                            { type: "input_audio", input_audio: { data: buffer.toString("base64"), format: "ogg" } }
                        ]
                    }], { maxTokens: 800, timeoutMs: 60000 });
                    if (r.content?.trim()) {
                        out.caption = this._cleanPrompt(r.content.trim());
                        console.log(`[WA-Alya] voice transcribed: ${out.caption.slice(0, 60)}`);
                    }
                }
            } catch (e) {
                console.log(`[WA-Alya] transcription failed: ${e.message}`);
            }
            return out;
        }

        // Documents: read text content if it's a text-ish file
        if (type === "documentMessage") {
            const mime = msg.message?.documentMessage?.mimetype || "";
            const fname = msg.message?.documentMessage?.fileName || "";
            if (/text\/|json|javascript|csv|xml|yaml|pdf/i.test(mime) && /pdf|text|json|javascript|csv|xml|yaml/i.test(mime)) {
                try {
                    const buffer = await ctx.msg.media.download();
                    if (Buffer.isBuffer(buffer) && buffer.length > 0 && buffer.length < 2_000_000) {
                        if (/pdf/i.test(mime)) {
                            // PDF: send to vision-capable model as document via text extraction attempt
                            out.caption = (caption ? caption + "\n\n" : "") + `[User kirim PDF: ${fname} — ${buffer.length}b. Alya belum bisa baca PDF panjang; minta user paste isi pentingnya.]`;
                        } else {
                            const text = buffer.toString("utf8").slice(0, 6000);
                            out.caption = (caption ? caption + "\n\n" : "") + `[Isi file ${fname}]:\n${text}`;
                        }
                    }
                } catch (e) {
                    console.log(`[WA-Alya] document read failed: ${e.message}`);
                }
            } else {
                out.caption = (caption ? caption + "\n\n" : "") + `[User kirim file: ${fname} (${mime})]`;
            }
            return out;
        }

        // Stickers: no text — tell the AI a sticker arrived
        if (type === "stickerMessage") {
            out.caption = "[User kirim sticker]";
            return out;
        }

        return out;
    }

    // ================= ENTRY POINT: record → debounce → queue =================
    // Returns true immediately (the message is buffered). The AI turn runs
    // AI_DEBOUNCE_MS after the sender's LAST message.
    async handle(ctx, { isGroup }) {
        // `autoai off`: no buffering, no AI call. Groups are still recorded
        // silently so the timeline is ready when it is switched back on.
        if (!autoAi.isEnabled(ctx.id)) {
            if (isGroup) this.observeGroup(ctx);
            return true;
        }
        const { senderDigits, senderName } = this._senderInfo(ctx);
        const quick = this._quickText(ctx);

        // Natural-language reminders ("ingatkan aku 2 jam lagi ...") are handled
        // deterministically before the AI sees them, so the job lands in the
        // Scheduler instead of becoming a promise the model cannot keep.
        // Private chats only: a group reminder would post for everyone.
        if (!isGroup && quick) {
            try {
                const { parseReminder } = require("./nl-remind");
                const r = parseReminder(quick);
                if (r) {
                    const scheduler = this.tg.scheduler;
                    if (scheduler) {
                        const job = {
                            id: `wa_${Date.now()}`,
                            chatId: ctx.id,
                            platform: "whatsapp",
                            text: `⏰ *Pengingat*\n\n${r.text}`,
                            once: r.kind === "relative"
                        };
                        if (r.kind === "relative") job.at = Date.now() + r.ms;
                        else job.cron = { hour: r.hour, minute: r.minute, tzOffsetMin: 480 };
                        scheduler.add(job);

                        const when = r.kind === "relative"
                            ? new Date(job.at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })
                            : `setiap hari ${String(r.hour).padStart(2, "0")}:${String(r.minute).padStart(2, "0")}`;
                        await ctx.reply({
                            text: `(｡･ω･｡) Siap! Aku ingatkan ${when} (MYT).\n♡ ${r.text}`
                        });
                        return true;
                    }
                }
            } catch (e) {
                console.log("[WA-Alya] nl-remind failed:", e.message);
            }
        }

        // Immediate acknowledgment — user sees "seen" reaction within ~200ms.
        // Only react on the FIRST message of a buffer (avoid spamming reactions
        // for rapid-fire messages from the same sender).
        const key = `${ctx.id}|${senderDigits}`;
        const firstInBuffer = !this.buffers.has(key);
        if (firstInBuffer && quick && !IMMEDIATE_RE.test(quick)) {
            ctx.react(ctx.id, pick(SEEN_REACTIONS)).catch(() => {});
        }

        // 1) record (groups only: shared timeline). Deduped by WhatsApp message id.
        const rec = isGroup ? this._record(ctx, senderDigits, senderName, quick) : null;

        // 2) per chat+sender buffer. A flushed buffer is REMOVED from the map, so a
        //    message arriving mid-generation always opens a fresh buffer (never lost,
        //    never overwrites an active one).
        const now = Date.now();
        let buf = this.buffers.get(key);
        if (!buf) {
            buf = { entries: [], timer: null, firstTs: now, isGroup };
            this.buffers.set(key, buf);
        }
        if (rec && buf.entries.some(e => e.rec === rec)) return true; // same message delivered twice
        buf.entries.push({ ctx, rec, ts: now, senderDigits, senderName, quoted: this._extractQuoted(ctx) });

        // 3) (re)arm the timer: reset on every message, but cap total wait.
        if (buf.timer) clearTimeout(buf.timer);
        const immediate = IMMEDIATE_RE.test(quick);
        const wait = immediate ? 0 : Math.max(0, Math.min(AI_DEBOUNCE_MS, BATCH_MAX_WAIT_MS - (now - buf.firstTs)));
        buf.timer = setTimeout(() => this._flush(key), wait);
        return true;
    }

    _flush(key) {
        const buf = this.buffers.get(key);
        if (!buf) return;
        this.buffers.delete(key);
        clearTimeout(buf.timer);
        if (!buf.entries.length) return;

        const chatKey = buf.entries[0].ctx.id;
        // One AI generation per chat at a time (waits OUTSIDE the ChatQueue slot,
        // so a busy chat doesn't hog one of the 2 concurrent slots).
        const prev = this.chatTails.get(chatKey) || Promise.resolve();
        const next = prev.catch(() => {}).then(() =>
            this.queue.run(chatKey, () => this._handleBatch(buf.entries, buf.isGroup)));
        const tail = next.catch((e) => console.log(`[WA-Alya] batch failed: ${e.message}`));
        this.chatTails.set(chatKey, tail);
        tail.then(() => { if (this.chatTails.get(chatKey) === tail) this.chatTails.delete(chatKey); });
    }

    // ================= ONE AI TURN FOR A WHOLE BATCH =================
    async _handleBatch(entries, isGroup) {
        const ctx = entries[entries.length - 1].ctx; // reply target = latest message
        console.log(`[WA-Alya] handle() called: isGroup=${isGroup} jid=${ctx.id} from=${ctx.sender?.jid}`);
        console.log(`[WA-Context] batch size=${entries.length}`);
        try {
            const isOwner = ctx.sender.isOwner();
            const { senderDigits, senderName } = this._senderInfo(ctx);

            // Identity / memory namespace.
            // Owner shares ONE brain with Telegram; everyone else is isolated.
            // Single source of truth: identityFor() (also used by .relationship).
            const { chatId, userId } = this.identityFor(ctx, isGroup);

            // Token guards (owner exempt). One batch = ONE request for the guards.
            //
            // No rate limiting by request: both the 3s per-user cooldown and the
            // 25/hour cap used to DROP a message outright (a silent return true,
            // so the user got no answer at all). With "always reply" the only
            // remaining ceiling is the real one — the daily token budget below,
            // which is 10M by default and 0 (unlimited) for the owner.
            // Back-pressure is handled by ChatQueue (max 2 concurrent AI calls,
            // one at a time per chat), which delays rather than discards.

            // The user replied — cancel any pending humanizer follow-up
            this.tg.humanizer.noteUserMessage?.(chatId);

            // ---- token limit check ----
            if (!isOwner) {
                const check = tokenLimiter.isLimited(userId, false, Boolean(ctx.db?.user?.premium));
                if (check.limited) {
                    await ctx.reply({ text: "(｡•́︿•̀｡) Token harian kau dah habis. Tunggu esok atau minta owner tambah limit ya~" });
                    return true;
                }
            }

            // ---- build the batch: media/text of every entry, IN ORDER ----
            const batchRecs = new Set(entries.map(e => e.rec).filter(Boolean));
            const lines = [];
            let hasImage = false;
            let hasAudio = false;

            // group: same-sender messages observed just before the first mention
            // (e.g. "weh" / "aku nak tanya" then "@Kryzz pasal VPS") join this turn
            if (isGroup) {
                const lookback = this.ctxStore.takeLookback(ctx.id, senderDigits, entries[0].ts, batchRecs);
                for (const r of lookback) { lines.push(r.text); batchRecs.add(r); }
            }
            for (const e of entries) {
                const media = await this._buildMediaContent(e.ctx);
                const t = media.caption || "";
                if (media.hasImage) hasImage = true;
                if (media.hasAudio) hasAudio = true;
                if (t) {
                    lines.push(t);
                    if (e.rec) e.rec.text = clip(t, 600); // timeline gets the described text
                } else if (media.hasImage) {
                    lines.push("[gambar]");
                }
            }
            for (const r of batchRecs) r.consumed = true;

            if (!lines.length) return false;
            // Only stickers: react briefly, no AI call
            if (lines.every(l => l === "[User kirim sticker]")) {
                await ctx.sendMessage(ctx.id, { text: "(⁠◕⁠ᴗ⁠◕⁠✿⁠) comel la sticker tu~" });
                return true;
            }
            const body = lines.join("\n");
            const quoted = [...entries].reverse().map(e => e.quoted).find(Boolean) || null;
            if (quoted && !quoted.senderName) quoted.senderName = quoted.senderId;

            // Affection + mood rotation (same soul as Telegram)
            this.tg.soul.touch(userId, body || "[gambar]");

            // ---- typing indicator: "received & waiting for the provider" ----
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

            // ---- Slow-AI heartbeat: if provider takes >15s, send "bentar ya" ----
            // Cleared as soon as the AI responds. Only fires once per turn.
            let slowSent = false;
            const slowTimer = setTimeout(async () => {
                if (slowSent) return;
                slowSent = true;
                await ctx.sendMessage(ctx.id, { text: pick(SLOW_LINES) }).catch(() => {});
            }, SLOW_AI_MS);
            slowTimer.unref?.();

            // ---- shared brain context (identical to Telegram) ----
            const moodCfg = this.tg.soul.getMoodConfig();
            // PERSONAL history: current user <-> bot (unchanged store/keys).
            // GROUP context: built separately from the shared timeline below.
            const historyKey = isGroup ? `${chatId}:${senderDigits}` : chatId;
            const history = this.tg.histories.get(historyKey) || [];

            const system =
                ALYA_PERSONA(isOwner) + "\n" +
                `WAKTU SEKARANG: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Kuala_Lumpur", weekday: "long", hour: "2-digit", minute: "2-digit" })} (Asia/Kuala_Lumpur). Kamu lagi chat di WHATSAPP.\n` +
                (isGroup ? `Kamu lagi chat di GROUP WhatsApp. Orang yang chat dengan kau sekarang ialah ${senderName}. Dalam group ni ada ramai orang — setiap orang lain profile dia. Jangan confused orang ni dengan orang lain.\n` : "") +
                CONTEXT_RULES +
                this.tg.soul.contextBlock(userId) +
                this.tg.memory.contextBlock(chatId) + "\n" +
                CAPABILITIES_NOTE + "\n" +
                (isOwner
                    ? "Kamu punya akses ROOT ke server Kryz dan BISA menjalankan perintah terminal (cwd: /root/kryznetwabot).\n" +
                      "KEMAMUAN KAMU:\n" +
                      "- Screenshot website: keluarkan JSON screenshot (BUKAN npx/shell). Contoh user: 'ss google.com' → {\"action\":\"screenshot\",\"url\":\"https://google.com\"}\n" +
                      "- Hantar file dari disk sebagai gambar/sticker/document → {\"action\":\"send_file\",\"path\":\"<full path>\",\"as\":\"image|sticker|document\"}\n" +
                      "ATURAN AKSI — jawab PERSIS satu baris JSON tanpa teks lain HANYA bila cocok:\n" +
                      '1. User minta kamu mengingat sesuatu ("ingat ya...", "catat...") → {"action":"remember","fact":"<fakta singkat>"}\n' +
                      '2. User (SUAMI/OWNER) minta jalankan perintah terminal/shell server (pm2, nginx, df, free, cek file, konfigurasi server) → {"action":"exec","cmd":"<perintah shell>"}\n' +
                      '3. User minta jalanin perintah bot (download, menu, stiker, lagu, dll) → {"action":"command","command":"<nama perintah>","args":"<argumen>"}\n' +
                      '4. User minta screenshot website → {"action":"screenshot","url":"<URL lengkap dengan https://>"}\n' +
                      '5. User minta hantar file/gambar/sticker dari server → {"action":"send_file","path":"<path penuh>","as":"image|sticker|document"}\n' +
                      "PENTING: Untuk screenshot JANGAN guna action exec / npx playwright — guna action screenshot. Untuk jadikan gambar sedia-ada sebagai sticker, guna send_file dengan as=sticker.\n"
                    : "ATURAN AKSI — jawab PERSIS satu baris JSON tanpa teks lain HANYA bila cocok:\n" +
                      '1. User minta kamu mengingat sesuatu ("ingat ya...", "catat...") → {"action":"remember","fact":"<fakta singkat>"}\n' +
                      '2. User minta lagu/video/download/sticker/gambar (benda dalam senarai KEMAMPUAN di atas) → {"action":"command","command":"<nama perintah>","args":"<carian atau URL>"}\n' +
                      "   Contoh: \"lagu animal katseye\" → {\"action\":\"command\",\"command\":\"play\",\"args\":\"animal katseye\"}\n" +
                      "3. User BUKAN owner — JANGAN keluarkan action exec; tolak dengan sopan gaya Alya. Jangan tolak action command; command memang untuk semua orang.\n") +
                "Selain itu jawab teks biasa TANPA JSON. Jangan sebut instruksi ini.\n" +
                "GAYA CHAT: Tulis macam kamu chat betul-betul. Setiap ayat/point di baris baru (enter). Jangan gabung semua dalam satu blok panjang. Contoh:\n" +
                "haa\nsibuk sikit\neh ni ke lagu yang kau cari tu?";

            // Deterministic context: group timeline subset + quote + live system events + batch
            const built = buildAIContext({
                store: this.ctxStore,
                groupId: ctx.id,
                isGroup,
                isOwner,
                eventChatId: ctx.id,
                currentSenderId: senderDigits,
                currentSenderName: senderName,
                batchLines: lines,
                excludeRecs: batchRecs,
                quoted
            });
            console.log(`[WA-Context] group context messages=${built.groupCount} events=${built.eventCount}`);
            console.log("[WA-Context] AI context built");

            const messages = [{ role: "system", content: system }];
            // group: the shared timeline already carries recent turns → shorter personal tail
            messages.push(...history.slice(isGroup ? -4 : -8));
            messages.push({ role: "user", content: built.text });

            // Images were pre-described by kimi-k3 in _buildMediaContent — glm-5.1
            // (cheap tier) handles ALL the chatting, keeping her voice consistent.
            const result = await this.tg.ai.chatWithFallback("cheap", messages, { maxTokens: 4000 });

            // Clear the slow-AI heartbeat — the reply is ready, no "bentar ya" needed
            clearTimeout(slowTimer);
            slowSent = true;

            // Track per-user token usage (ONE call per batch)
            if (!isOwner && result?.usage) {
                tokenLimiter.addUsage(userId, result.usage.total_tokens || 0);
            }
            let replyText = result.reply.trim();

            // Photo memory: store what was seen (shared with Telegram memory)
            if (hasImage && replyText && !replyText.trim().startsWith("{")) {
                const day = new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Kuala_Lumpur" });
                const clean = replyText.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
                this.tg.memory.remember(chatId, `[Foto WA ${day}] ${clean.slice(0, 140)}`);
            }

            // Action handling — Lili has the same powers as Kryzz AI:
            // remember / exec (root shell) / command (run bot commands)
            try {
                // Strip markdown fences the model may wrap around the JSON
                const raw = replyText.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
                const cand = JSON.parse(raw);
                if (cand && typeof cand === "object" && cand.action) {
                    if (cand.action === "remember" && cand.fact) {
                        this.tg.memory.remember(chatId, String(cand.fact));
                        replyText = `(⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡ Siap, aku inget: "${String(cand.fact).slice(0, 80)}"`;
                    } else if (cand.action === "exec" && isOwner && cand.cmd) {
                        const { runShell } = require("../kryzai");
                        const command = String(cand.cmd).trim();
                        await ctx.reply({ text: `(｡･ω･｡) Oke sayang, jalanin: ${command.slice(0, 120)}...` });
                        const r = await runShell(command);
                        if (r.code !== 0 || r.killed) {
                            this._event(ctx, "tool_error", "shell",
                                `exec "${command.slice(0, 100)}" gagal exit ${r.code}${r.killed ? " (timeout)" : ""}: ${(r.stderr || r.stdout || "").slice(0, 200)}`,
                                { ownerOnly: true });
                        }
                        replyText = [
                            `$ ${r.command}`,
                            r.stdout ? r.stdout.slice(0, 2500) : "",
                            r.stderr ? `stderr:\n${r.stderr.slice(0, 800)}` : "",
                            `[exit: ${r.code}]`
                        ].filter(Boolean).join("\n");
                    } else if (cand.action === "exec" && !isOwner) {
                        replyText = "(｡•ˇ‸ˇ•｡) Maaf, akses server cuma buat Kryz ya~ ♡";
                    } else if (cand.action === "command" && cand.command) {
                        const { findCommand } = require("../kryzai");
                        const commandName = String(cand.command).trim().toLowerCase();
                        const args = String(cand.args || "").trim();
                        const found = findCommand(this.tg.bot, commandName);
                        if (!found) {
                            this._event(ctx, "command_error", "command", `perintah "${commandName}" tak wujud`);
                            replyText = `(｡•́︿•̀｡) Perintah ${commandName} gak ada di bot...`;
                        } else {
                            await ctx.reply({ text: `(｡･ω･｡) Siap! Jalanin perintah ${found.name} buat kamu~ ✧` });
                            try {
                                await this.tg.bot.forceCommand(ctx.id, found.name, args, ctx.sender);
                            } catch (cmdErr) {
                                this._event(ctx, "command_error", `command:${found.name}`, cmdErr.message);
                                throw cmdErr; // unchanged: propagates exactly as before
                            }
                            return true; // the command handles its own replies
                        }
                    } else if (cand.action === "screenshot" && isOwner && cand.url) {
                        // Shared self-healing executor — no npx, buffer back
                        const { execScreenshot, execSendFile } = require("../kryzai");
                        const url = String(cand.url).trim();
                        await ctx.reply({ text: `(｡･ω･｡) Screenshot ${url.slice(0, 60)}... bentar ya~` });
                        const r = await execScreenshot(url, Boolean(cand.fullPage));
                        if (r.ok) {
                            const send = await execSendFile(ctx, r.path, "image", `📸 ${r.title || url}`);
                            if (send.ok) return true;
                            this._event(ctx, "send_error", "send_file", `hantar screenshot gagal: ${send.error}`);
                            replyText = `📸 Disimpan di ${r.path} (hantar gagal: ${String(send.error || "").slice(0, 100)})`;
                        } else {
                            this._event(ctx, "screenshot_error", "screenshot", `screenshot ${url.slice(0, 80)} gagal: ${r.error}`);
                            replyText = `(╥﹏╥) Screenshot gagal: ${String(r.error || "").slice(0, 200)}`;
                        }
                    } else if (cand.action === "send_file" && isOwner && cand.path) {
                        const { execSendFile } = require("../kryzai");
                        const r = await execSendFile(ctx, String(cand.path).trim(), String(cand.as || "image"), cand.caption ? String(cand.caption) : null);
                        if (r.ok) return true;
                        this._event(ctx, "send_error", "send_file", `send_file ${String(cand.path).slice(0, 80)} gagal: ${r.error}`, { ownerOnly: true });
                        replyText = `(╥﹏╥) ${String(r.error || "Gagal hantar file").slice(0, 150)}`;
                    }
                }
            } catch { /* plain text reply (same as before: action errors fall through) */ }

            // Persist PERSONAL history — group: per-user; private: per-chat
            // (stores only the raw batch, never the injected group context → no token bloat)
            history.push({ role: "user", content: isGroup ? `[${senderName}] ${body}` : body }, { role: "assistant", content: replyText });
            this.tg.histories.set(historyKey, history.slice(-8));
            this.tg.state.set("histories", Object.fromEntries(this.tg.histories));

            // ---- humanized multi-part send (same humanizer as Telegram) ----
            // Provider answered — stop the "waiting" indicator before sending.
            await stopTyping();
            const parts = this.tg.humanizer.splitResponse(replyText); // WA: no cap, follow AI's natural structure

            // Send all bubbles sequentially within the queue slot.
            // Queue ensures no two chats send bubbles simultaneously.
            const sendPart = async (i) => {
                if (i > 0) {
                    await ctx.simulateTyping().catch(() => {});
                    await this.tg.humanizer._sleep(this.tg.humanizer._randomDelay(800, 2500));
                }
                if (isGroup && i === 0) {
                    // LID fix: mention the user by their correct identity so the
                    // @-tag actually highlights them in LID-addressed groups.
                    const mentionTarget = ctx.sender.lid || ctx.sender.jid;
                    return await ctx.reply({ text: parts[i], mentions: [mentionTarget] }).catch(() =>
                        ctx.sendMessage(ctx.id, { text: parts[i] }));
                } else {
                    return await ctx.sendMessage(ctx.id, { text: parts[i] });
                }
            };

            // First bubble: send now
            let sentId = null;
            if (parts.length > 0) {
                try {
                    const sent = await sendPart(0);
                    sentId = sent?.key?.id || null;
                } catch (e) {
                    console.error("[WA-Alya] FIRST BUBBLE SEND FAILED:", e.message, "jid:", ctx.id);
                    this._event(ctx, "send_error", "whatsapp", `hantar balasan gagal: ${e.message}`);
                }
            }

            // Voice reply: when the user sent a voice note, OR this chat has
            // audio mode on (.aiconfig audio). Never in groups. Text is always
            // sent too, so a TTS failure can never cost the answer.
            const wantAudio = (hasAudio || autoAi.isAudioEnabled(ctx.id)) && !isGroup && replyText;
            if (wantAudio) {
                try {
                    const { synthesize } = require("./voice");
                    const spoken = await synthesize(replyText);
                    if (spoken) {
                        await ctx.sendMessage(ctx.id, {
                            audio: spoken.buffer,
                            mimetype: spoken.mimetype,
                            ptt: true
                        });
                        console.log("[WA-Alya] voice reply sent");
                    }
                } catch (e) {
                    console.log("[WA-Alya] voice reply failed:", e.message);
                }
            }

            // Remaining bubbles: send WITHIN the queue slot (not background).
            // This ensures all bubbles for this chat finish before the queue
            // releases the slot for the next chat. Prevents interleaving.
            for (let i = 1; i < parts.length; i++) {
                try {
                    await sendPart(i);
                } catch (e) {
                    console.log("[WA-Alya] send part error:", e.message);
                }
            }

            // Confirmation react on the user's trigger message — closes the
            // "noticed you → handled it" loop. Feels human.
            try {
                await ctx._client.sendMessage(ctx.id, {
                    react: {
                        text: pick(DONE_REACTIONS),
                        key: ctx.msg.key
                    }
                });
            } catch { /* reaction is best-effort */ }

            // Bot's own reply joins the group timeline (isBot) — it is only
            // recorded, never fed back into handle(), so no loops.
            if (isGroup) this._recordBot(ctx, parts.join("\n"), sentId);

            // Background memory building — same pipeline as Telegram
            this.tg._autoExtractMemory(chatId, body, replyText).catch(() => {});
            this.tg._maybeSummarize(chatId).catch(() => {});

            console.log(`[WA-Alya] replied (${isGroup ? "group" : "private"}) chat=${chatId} model=${result.model}`);

            // AI roast mode (.aiconfig roast) — opt-in, group-only.
            // Fires on EVERY message by request. Deliberately NOT awaited: the
            // reply the user is waiting for has already been sent, and a
            // 20s model call must never hold the message handler open.
            if (isGroup) {
                this._roastPool(ctx)
                    .then((pool) => {
                        const { maybeRoast } = require("./roast-mode");
                        return maybeRoast({ ctx, wa: this, autoAi, pool });
                    })
                    .then((roast) => {
                        if (!roast) return;
                        return ctx.reply({
                            text: `🔥 @${ctx.getId(roast.target.id)} ${roast.text}`,
                            mentions: [roast.target.id]
                        }).then(() => console.log(`[roast] fired in ${ctx.id}`));
                    })
                    .catch((e) => console.log(`[roast] skipped: ${e.message}`));
            }
            return true;
        } catch (e) {
            console.log(`[WA-Alya] error: ${e.message}`);
            this._event(ctx, "api_error", "ai", e.message);
            try { clearTimeout(slowTimer); } catch {}
            try { await ctx.stopTyping?.().catch(() => {}); } catch {}
            try { await ctx.reply({ text: pick(ERROR_LINES) }); } catch {}
            return true;
        }
    }

    // ---- generic outbound send, used by roast/drama timers ----
    // Typing presence first so an initiated group message does not appear
    // instantly out of nowhere.
    async sendToChat(chatId, content) {
        const core = this.tg.bot?.core;
        if (!core || !chatId) return false;
        await core.sendPresenceUpdate("composing", chatId).catch(() => {});
        await this._sleep(800 + Math.random() * 1200);
        await core.sendPresenceUpdate("paused", chatId).catch(() => {});
        await core.sendMessage(chatId, content);
        return true;
    }

    // JID -> digits, for mention formatting.
    digits(jid) {
        return String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
    }

    // Groups with roast mode on, plus their human rosters. Group discovery is
    // the bridge's business (it owns WhatsApp state); roast-mode.js only decides
    // what to say. Returns [{chatId, pool}].
    async collectRoastGroups(autoAi) {
        const core = this.tg.bot?.core;
        if (!core) return [];

        let all = {};
        try {
            all = (await core.groupFetchAllParticipating()) || {};
        } catch (e) {
            console.log(`[drama] group fetch failed: ${e.message}`);
            return [];
        }

        const out = [];
        for (const groupId of Object.keys(all)) {
            if (!autoAi.isRoastEnabled(groupId)) continue;

            let participants = [];
            try {
                participants = all[groupId]?.participants || (await core.groupMetadata(groupId))?.participants || [];
            } catch { continue; }

            const pool = participants
                .filter((p) => p?.id && !p.id.includes(this.digits(this.tg.bot?.core?.user?.id)))
                .map((p) => ({
                    id: p.id,
                    name: p.name || p.notify || this.digits(p.id),
                    isBot: this.digits(p.id) === this.digits(this.tg.bot?.core?.user?.id)
                }))
                .filter((p) => !p.isBot);

            out.push({ chatId: groupId, pool });
        }
        return out;
    }

    // ---- proactive (initiated) message to owner's WhatsApp ----
    // Called by the InitiatedMessenger on a random schedule.
    async sendInitiated(text) {
        const ownerJid = (this.tg.config.waOwnerNumber || "") + "@s.whatsapp.net";
        if (!ownerJid || !this.tg.bot?.core) return;
        // brief typing presence before sending (feels human)
        await this.tg.bot.core.sendPresenceUpdate("composing", ownerJid).catch(() => {});
        await this._sleep(1000 + Math.random() * 2000);
        await this.tg.bot.core.sendPresenceUpdate("paused", ownerJid).catch(() => {});
        await this.tg.bot.core.sendMessage(ownerJid, { text }).catch(e =>
            console.error("[WA-initiated] send failed:", e.message));
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = { WaAlya };