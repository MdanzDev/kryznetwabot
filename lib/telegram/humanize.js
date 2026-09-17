// humanize.js — human behavior simulation for Telegram messages.
// Splits AI responses into 1-3 separate messages, adds typing delays,
// occasional intentional typos with corrections, and no-reply follow-ups.

const SPLIT_MIN_DELAY = 800;   // ms between split messages (min)
const SPLIT_MAX_DELAY = 3000;  // ms between split messages (max)
const BASE_READ_DELAY = 400;   // ms before first message (reading delay)
const BASE_READ_MAX = 2000;

const TYPO_CHANCE = 0.10;      // 10% chance per multi-part message to add a typo+correction
const FOLLOWUP_MIN_MS = 30 * 60000;  // 30 min
const FOLLOWUP_MAX_MS = 60 * 60000;  // 60 min
const FOLLOWUP_CHANCE = 0.35;  // 35% chance to send a follow-up if no reply

const FOLLOWUP_LINES = [
    "eh tidur ke?",
    "eh kau dah?",
    "eh belum balas?",
    "eh kau kat mana",
    "eh halo",
    "eh hidup ke masih",
    "eh busy ke",
    "eh mana",
    "eh ko bussy",
    "eh jangan ghost aku",
    "eh tidur ke nih",
    "eh kau still hidup?"
];

class Humanizer {
    constructor(tg, store = null, ownerIds = []) {
        this.tg = tg;
        this.store = store;
        this.ownerIds = ownerIds;
        this.pendingFollowups = new Map(); // chatId -> { timer, sentAt }
        this.lastUserMessage = new Map();   // chatId -> timestamp
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

    // Mark user activity (call on every incoming message)
    noteUserMessage(chatId) {
        this.lastUserMessage.set(String(chatId), Date.now());
        // Cancel any pending follow-up — user just replied
        this._cancelFollowup(chatId);
    }

    // Schedule a follow-up if user doesn't reply within 30-60 mins
    // Called after Alya sends a reply (not after initiated messages)
    scheduleFollowup(chatId, delay = null) {
        this._cancelFollowup(chatId);
        const wait = delay || this._randomDelay(FOLLOWUP_MIN_MS, FOLLOWUP_MAX_MS);
        const timer = setTimeout(() => {
            // Check if user replied since
            const lastUser = this.lastUserMessage.get(String(chatId)) || 0;
            const sinceLastUser = Date.now() - lastUser;
            // Only follow up if enough time has passed AND random chance hits
            if (sinceLastUser >= FOLLOWUP_MIN_MS && Math.random() < FOLLOWUP_CHANCE) {
                const line = FOLLOWUP_LINES[Math.floor(Math.random() * FOLLOWUP_LINES.length)];
                this.tg.sendMessage(String(chatId), line).catch(() => {});
                console.log(`[TG-humanize] follow-up sent to ${chatId}: "${line}"`);
            }
            this.pendingFollowups.delete(String(chatId));
        }, wait);
        timer.unref?.();
        this.pendingFollowups.set(String(chatId), { timer, scheduledAt: Date.now() });
    }

    _cancelFollowup(chatId) {
        const entry = this.pendingFollowups.get(String(chatId));
        if (entry) {
            clearTimeout(entry.timer);
            this.pendingFollowups.delete(String(chatId));
        }
    }

    // Split a response into 1-3 parts at natural break points.
    // The split is PROBABILISTIC — sometimes 1 message, sometimes 2, rarely 3.
    // This prevents the "always 3 messages" pattern that feels structured/robotic.
    splitResponse(text, moodMaxParts = 3) {
        const maxParts = Math.min(moodMaxParts, 3);
        const cleaned = text.trim();
        if (!cleaned) return [text];

        // Short replies: never split (under ~50 chars)
        if (cleaned.length < 50) {
            return [cleaned];
        }

        // PROBABILISTIC split target: don't always aim for maxParts.
        // Weight toward fewer parts: 1 part (40%), 2 parts (40%), 3 parts (20%)
        let targetParts;
        const roll = Math.random();
        if (roll < 0.40) targetParts = 1;
        else if (roll < 0.80) targetParts = 2;
        else targetParts = Math.min(maxParts, 3);
        // If the mood limits to 1 (sleepy/busy), respect it
        targetParts = Math.min(targetParts, maxParts);

        // If target is 1, just return the whole thing (but clean up double newlines)
        if (targetParts <= 1) {
            return [cleaned.replace(/\n{3,}/g, "\n\n").trim()];
        }

        // Try splitting on double newlines first
        let parts = cleaned.split(/\n\n+/).map(s => s.trim()).filter(Boolean);

        // If only 1 part, try splitting on single newlines
        if (parts.length < 2 && cleaned.includes("\n")) {
            parts = cleaned.split(/\n/).map(s => s.trim()).filter(Boolean);
        }

        // If still 1 part and long enough, try splitting on sentence boundaries
        if (parts.length < 2 && cleaned.length > 120) {
            const sentences = cleaned.match(/[^.!?]*[.!?]+[\s]*|[^.!?]*$/g) || [cleaned];
            parts = sentences.map(s => s.trim()).filter(Boolean);
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

        // If we got more than targetParts, merge extras into the last part
        while (parts.length > targetParts) {
            const last = parts.pop();
            parts[parts.length - 1] += "\n" + last;
        }

        return parts.length > 0 ? parts : [cleaned];
    }

    // Maybe inject a typo+correction into a part
    // "everything" -> "everythibt* everything" (occasional, ~10%)
    maybeAddTypo(part) {
        if (Math.random() > TYPO_CHANCE) return part;
        // Find a word to typo (4+ chars, not all caps)
        const words = part.match(/\b[a-zA-Z]{4,}\b/g);
        if (!words || words.length === 0) return part;

        const target = words[Math.floor(Math.random() * words.length)];
        // Only typo lowercase words (not proper nouns / all-caps)
        if (target !== target.toLowerCase() && target === target.toUpperCase()) return part;

        // Swap two adjacent letters to create a believable typo
        if (target.length < 4) return part;
        const idx = 1 + Math.floor(Math.random() * (target.length - 2));
        const arr = target.split("");
        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
        const typoed = arr.join("");

        // Replace first occurrence of target with "typoed* target"
        const replacement = `${typoed}* ${target}`;
        return part.replace(target, replacement);
    }

    // Send a response with human-like behavior:
    // 1. Brief reading delay
    // 2. Split into parts
    // 3. Typing delay between parts
    // 4. Occasional typo+correction
    // Returns the list of message texts that were sent.
    async sendHumanized(chatId, text, options = {}) {
        const moodMaxParts = options.maxParts || 3;
        const skipSplit = options.skipSplit || false;
        const isInitiated = options.isInitiated || false;

        // Initial "reading" delay
        if (!skipSplit) {
            await this._sleep(this._randomDelay(BASE_READ_DELAY, BASE_READ_MAX));
        }

        let parts;
        if (skipSplit || isInitiated) {
            parts = [text.trim()];
        } else {
            parts = this.splitResponse(text, moodMaxParts);
            // Maybe add a typo to one of the parts (only the first or second)
            if (parts.length > 0 && Math.random() < TYPO_CHANCE) {
                const typoIdx = Math.min(parts.length - 1, Math.floor(Math.random() * 2));
                parts[typoIdx] = this.maybeAddTypo(parts[typoIdx]);
            }
        }

        // Send each part with a delay between them
        for (let i = 0; i < parts.length; i++) {
            if (i > 0) {
                // Send typing indicator before delay
                await this.tg.sendChatAction(chatId, "typing").catch(() => {});
                await this._sleep(this._randomDelay(SPLIT_MIN_DELAY, SPLIT_MAX_DELAY));
            }
            // For the last part, don't add extra delay
            await this.tg.sendMessage(chatId, parts[i]).catch(e =>
                console.error("[TG-humanize] send part failed:", e.message));
        }

        // Schedule follow-up if this wasn't an initiated message
        if (!isInitiated) {
            this.scheduleFollowup(chatId);
        }

        return parts;
    }
}

module.exports = { Humanizer, FOLLOWUP_LINES };
