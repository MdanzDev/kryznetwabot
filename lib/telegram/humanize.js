// humanize.js — human behavior simulation for Telegram messages.
// Splits AI responses into 1-3 separate messages, adds typing delays,
// occasional intentional typos with corrections, and no-reply follow-ups.
//
// UX improvements over v1:
// - Follow-up lines are toned down (no "jangan ghost aku" desperation)
// - Follow-ups skipped if the AI's last message was a QUESTION
// - Read delay scales with message length (reading a paragraph takes longer)
// - Typo is split into TWO bubbles (typo → "*correction") — real human pattern
// - Split doesn't break greetings/sign-offs alone
// - Follow-up tone shifts with mood (if available)

const SPLIT_MIN_DELAY = 800;   // ms between split messages (min)
const SPLIT_MAX_DELAY = 3000;  // ms between split messages (max)
const BASE_READ_DELAY = 400;   // ms before first message (reading delay, min)
const BASE_READ_MAX = 2000;    // ms before first message (reading delay, max)

const TYPO_CHANCE = 0.10;      // 10% chance per multi-part message to add a typo+correction
const FOLLOWUP_MIN_MS = 30 * 60000;  // 30 min
const FOLLOWUP_MAX_MS = 60 * 60000;  // 60 min
const FOLLOWUP_CHANCE = 0.35;  // 35% chance to send a follow-up if no reply

// ── Follow-up tone variants ─────────────────────────────────
// Split by vibe so the follow-up matches the mood of the conversation.

const FOLLOWUP_CASUAL = [
    "eh kau dah?",
    "eh halo",
    "eh busy ke",
    "eh mana pergi",
    "wehh",
    "eh masih kat sana?",
];

const FOLLOWUP_WARM = [
    "eh tidur ke?",
    "eh kau ok tak?",
    "eh takde khabar?",
    "eh sunyi pulak",
    "eh kau still ada?",
];

const FOLLOWUP_PLAYFUL = [
    "eh ilang pulak",
    "eh kau kemana",
    "eh hilang ke",
    "eh tak nampak kau",
];

class Humanizer {
    constructor(tg, store = null, ownerIds = []) {
        this.tg = tg;
        this.store = store;
        this.ownerIds = ownerIds;
        this.pendingFollowups = new Map(); // chatId -> { timer, scheduledAt, lastBotLine }
        this.lastUserMessage = new Map();   // chatId -> timestamp
        this.lastBotMessage = new Map();    // chatId -> { text, wasQuestion, sentAt }
    }

    _sleep(ms) {
        return new Promise(resolve => {
            const t = setTimeout(resolve, ms);
            t.unref?.();
        });
    }

    _randomDelay(min, max) {
        return Math.floor(min + Math.random() * (max - min));
    }

    // ── UX: read delay scales with message length ──────────────
    // Reading "hi" should feel instant; reading a paragraph should feel
    // like the bot is actually parsing it. This makes the bot feel less
    // like a machine that always replies at the same speed.
    _readDelay(text) {
        const len = String(text || "").length;
        const base = this._randomDelay(BASE_READ_DELAY, BASE_READ_MAX);
        if (len < 30) return base;
        if (len < 120) return base + this._randomDelay(200, 600);
        if (len < 400) return base + this._randomDelay(500, 1200);
        return base + this._randomDelay(800, 2000);
    }

    // Mark user activity (call on every incoming message)
    noteUserMessage(chatId) {
        const key = String(chatId);
        this.lastUserMessage.set(key, Date.now());
        // Cancel any pending follow-up — user just replied
        this._cancelFollowup(key);
    }

    // Remember what the bot just said — used to decide whether a follow-up
    // makes sense (a follow-up after a question feels naggy; after a statement
    // it feels natural).
    noteBotMessage(chatId, text) {
        const key = String(chatId);
        const trimmed = String(text || "").trim();
        this.lastBotMessage.set(key, {
            text: trimmed,
            wasQuestion: /[?？]\s*$/.test(trimmed),
            sentAt: Date.now()
        });
    }

    // Schedule a follow-up if user doesn't reply within 30-60 mins
    // Called after Alya sends a reply (not after initiated messages)
    scheduleFollowup(chatId, delay = null) {
        const key = String(chatId);
        this._cancelFollowup(key);

        // UX: don't follow up right after asking a question — it reads as
        // nagging. Let the user have space to answer.
        const last = this.lastBotMessage.get(key);
        if (last?.wasQuestion && Date.now() - last.sentAt < FOLLOWUP_MIN_MS) {
            console.log(`[TG-humanize] skip follow-up to ${key} (bot asked a question)`);
            return;
        }

        const wait = delay || this._randomDelay(FOLLOWUP_MIN_MS, FOLLOWUP_MAX_MS);

        const timer = setTimeout(() => {
            const lastUser = this.lastUserMessage.get(key) || 0;
            const sinceLastUser = Date.now() - lastUser;

            // Only follow up if enough time has passed AND random chance hits
            if (sinceLastUser < FOLLOWUP_MIN_MS) {
                this.pendingFollowups.delete(key);
                return;
            }
            if (Math.random() >= FOLLOWUP_CHANCE) {
                this.pendingFollowups.delete(key);
                return;
            }

            // UX: pick tone based on time since last user message.
            // <1h: casual nudge
            // 1-3h: warm check-in
            // >3h: light/playful (long silence = don't be too needy)
            let pool;
            const hours = sinceLastUser / 3600000;
            if (hours < 1) pool = FOLLOWUP_CASUAL;
            else if (hours < 3) pool = FOLLOWUP_WARM;
            else pool = FOLLOWUP_PLAYFUL;

            const line = pool[Math.floor(Math.random() * pool.length)];
            this.tg.sendMessage(key, line).catch(() => {});
            console.log(`[TG-humanize] follow-up sent to ${key} (${hours.toFixed(1)}h): "${line}"`);

            this.pendingFollowups.delete(key);
        }, wait);
        timer.unref?.();

        this.pendingFollowups.set(key, { timer, scheduledAt: Date.now() });
    }

    _cancelFollowup(chatId) {
        const key = String(chatId);
        const entry = this.pendingFollowups.get(key);
        if (entry) {
            clearTimeout(entry.timer);
            this.pendingFollowups.delete(key);
        }
    }

    // Split a response into parts at natural break points.
    // The split is driven ENTIRELY by the text's own structure — how the AI
    // naturally broke its response into paragraphs/sentences. No dice rolls,
    // no forced target count. If the AI wrote one line, it's one message.
    // If it wrote ten paragraphs, it's ten messages. moodMaxParts only
    // acts as a ceiling so sleepy moods don't over-split.
    splitResponse(text, moodMaxParts = 999) {
        const maxParts = moodMaxParts;
        const cleaned = String(text || "").trim();
        if (!cleaned) return [text];

        // Short replies with no paragraph breaks: don't split (under ~50 chars)
        if (cleaned.length < 50 && !/\n/.test(cleaned)) {
            return [cleaned];
        }

        // Find natural break points, strongest signal first:
        // 1. Double newlines (paragraph breaks) — the AI intended separate blocks
        let parts = cleaned.split(/\n\n+/).map(s => s.trim()).filter(Boolean);

        // 2. Single newlines are NOT bubble breaks.
        //
        // Every newline used to become its own WhatsApp message, so a three-line
        // answer arrived as three separate bubbles, each one pinging the group.
        // The style prompt explicitly asks for one idea per line, which made it
        // worse. A newline is a visual line inside one message; only a blank
        // line (an intentional paragraph) or a sentence boundary should split.
        // Step 1 already handled blank lines; nothing to do here.

        // 3. Sentence boundaries — only for genuinely long text with no breaks.
        // Splitting a normal 2-3 sentence reply into a bubble per sentence is
        // what produced walls of one-line messages in the group. Raise the bar
        // so only a long paragraph (300+ chars) is ever broken up.
        if (parts.length < 2 && cleaned.length > 300) {
            const sentences = cleaned.match(/[^.!?]*[.!?]+[\s]*|[^.!?]*$/g) || [cleaned];
            parts = sentences.map(s => s.trim()).filter(Boolean);

            // Merge very short fragments into the previous part
            const merged = [];
            for (const p of parts) {
                if (p.length < 30 && merged.length > 0) {
                    merged[merged.length - 1] += " " + p;
                } else {
                    merged.push(p);
                }
            }
            parts = merged;
        }

        // UX: don't leave a 2-word greeting or sign-off alone as its own
        // bubble. "hai" / "ok" / "bye" floating on its own looks weird.
        if (parts.length > 1) {
            const shortOnly = (s) => s.length < 15 && !/[.!?]/.test(s);
            // Merge short firsts into the next part
            while (parts.length > 1 && shortOnly(parts[0])) {
                parts[1] = parts[0] + "\n" + parts[1];
                parts.shift();
            }
            // Merge short lasts into the previous part
            while (parts.length > 1 && shortOnly(parts[parts.length - 1])) {
                const last = parts.pop();
                parts[parts.length - 1] += "\n" + last;
            }
        }

        // Cap at moodMaxParts: if the AI wrote more blocks than the mood allows
        // (e.g. sleepy = 1), merge extras into the last part.
        while (parts.length > maxParts) {
            const last = parts.pop();
            parts[parts.length - 1] += "\n" + last;
        }

        return parts.length > 0 ? parts : [cleaned];
    }

    // Build a typo pair: [typoed, correction]
    // "everything" -> ["everythnig", "everything"]
    // Real humans send these as TWO bubbles: typo first, then correction.
    buildTypoPair(part) {
        // Find a word to typo (4+ chars, not all caps)
        const words = part.match(/\b[a-zA-Z]{4,}\b/g);
        if (!words || words.length === 0) return null;

        // Prefer mid-length, lowercase words (more believable to typo)
        const candidates = words.filter(w => w.length >= 4 && w.length <= 10 && w === w.toLowerCase());
        if (!candidates.length) return null;

        const target = candidates[Math.floor(Math.random() * candidates.length)];

        // Swap two adjacent letters to create a believable typo
        const idx = 1 + Math.floor(Math.random() * (target.length - 2));
        const arr = target.split("");
        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
        const typoed = arr.join("");

        if (typoed === target) return null;

        // Split the text: everything before the typo stays as-is, the typo
        // becomes its own message, the correction carries the rest.
        const start = part.indexOf(target);
        if (start === -1) return null;

        const before = part.slice(0, start).trimEnd();
        const after = part.slice(start + target.length);

        // Build the two bubbles
        // Bubble 1: "before + typoed"   (the typo message)
        // Bubble 2: "*target + after"   (the correction)
        const first = (before ? before + " " : "") + typoed;
        const second = "*" + target + after;

        // Sanity: don't create empty bubbles
        if (!first.trim() || !second.trim()) return null;

        return { first: first.trim(), second: second.trim() };
    }

    // Legacy single-message typo — kept in case anything else calls it.
    maybeAddTypo(part) {
        const pair = this.buildTypoPair(part);
        if (!pair) return part;
        return `${pair.first}* ${pair.second.replace(/^\*/, "")}`;
    }

    // Send a response with human-like behavior:
    // 1. Brief reading delay (scaled by length)
    // 2. Split into parts
    // 3. Typing delay between parts
    // 4. Occasional typo+correction (as a separate bubble)
    // Returns the list of message texts that were sent.
    async sendHumanized(chatId, text, options = {}) {
        const moodMaxParts = options.maxParts || 3;
        const skipSplit = options.skipSplit || false;
        const isInitiated = options.isInitiated || false;

        // Initial "reading" delay — scaled to text length
        if (!skipSplit) {
            await this._sleep(this._readDelay(text));
        }

        let parts;
        let typoPair = null;

        if (skipSplit || isInitiated) {
            parts = [String(text || "").trim()];
        } else {
            parts = this.splitResponse(text, moodMaxParts);

            // UX: typo fires as its own bubble pair. Only on multi-part messages
            // or longer single messages — short replies don't get typos because
            // they look unnatural (nobody typos "ok").
            const looksLongEnough = parts.length > 1 || (parts[0] && parts[0].length > 40);
            if (looksLongEnough && Math.random() < TYPO_CHANCE) {
                // Try the first part first, then the second
                const tryIdx = parts.length > 1 ? Math.floor(Math.random() * 2) : 0;
                typoPair = this.buildTypoPair(parts[tryIdx]);
                if (typoPair) {
                    // Replace the target part with the correction — the typo
                    // bubble is inserted right before it during send.
                    parts[tryIdx] = typoPair.second;
                }
            }
        }

        // Send each part with a delay between them
        for (let i = 0; i < parts.length; i++) {
            if (i > 0) {
                // Send typing indicator before delay
                await this.tg.sendChatAction(chatId, "typing").catch(() => {});
                await this._sleep(this._randomDelay(SPLIT_MIN_DELAY, SPLIT_MAX_DELAY));
            }

            // If this part has a typo pair, send the typo FIRST as its own
            // bubble, pause, then send the correction.
            if (typoPair && i === (parts.length > 1 ? 1 : 0)) {
                // Typo bubble
                await this.tg.sendChatAction(chatId, "typing").catch(() => {});
                await this.tg.sendMessage(chatId, typoPair.first).catch(e =>
                    console.error("[TG-humanize] typo send failed:", e.message));
                await this._sleep(this._randomDelay(600, 1400));

                // Correction bubble (the real text)
                await this.tg.sendChatAction(chatId, "typing").catch(() => {});
                await this.tg.sendMessage(chatId, typoPair.second).catch(e =>
                    console.error("[TG-humanize] correction send failed:", e.message));
                continue;
            }

            await this.tg.sendMessage(chatId, parts[i]).catch(e =>
                console.error("[TG-humanize] send part failed:", e.message));
        }

        // Remember what the bot just said — used by scheduleFollowup to
        // decide whether a follow-up reads as natural or as nagging.
        this.noteBotMessage(chatId, parts.join(" "));

        // Schedule follow-up if this wasn't an initiated message
        if (!isInitiated) {
            this.scheduleFollowup(chatId);
        }

        return parts;
    }
}

module.exports = { Humanizer, FOLLOWUP_LINES: FOLLOWUP_CASUAL };