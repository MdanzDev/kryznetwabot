// initiated.js — random initiated (proactive) messages.
// Generates 3-5 random send times daily within 9am-11pm (KL).
// Messages feel casual and spontaneous. Tracks sent messages to avoid
// repeating the same one within 7 days.

const { Store } = require("./store");

const WINDOW_START = 9;  // 9am
const WINDOW_END = 23;   // 11pm (23:00)
const MIN_PER_DAY = 3;
const MAX_PER_DAY = 5;

// Curated pool of casual, spontaneous openers.
// Each has variants so the AI never sends the exact same string.
const INITIATED_POOL = {
    morning: [
        "eh bangun dah?",
        "pagi pagi buta ko lamek bgn 😭",
        "bangun bangun",
        "eh dah sarapan?",
        "jangan lupa sarapan ya"
    ],
    afternoon: [
        "lapar ni",
        "eh makan belum?",
        "tengah buat apa?",
        "sibuk ke?",
        "eh lagi sibuk ga",
        "break dulu la"
    ],
    evening: [
        "eh buat apa tu",
        "makan malam dah?",
        "jangan lupa makan",
        "eh main game ke",
        "ngobrol bentar?",
        "eh ada apa"
    ],
    night: [
        "tidur belum?",
        "eh jangan begadang",
        "belom tidur?",
        "nanti sakit lo",
        "eh goodnight",
        "jangan lupa tidur awal"
    ],
    random: [
        "eh",
        "lagi apa nih",
        "eh bentar",
        "eh ada benda nak cakap",
        "eh apa khabar",
        "jangan lupa minum air",
        "eh lupa nak tanya",
        "tengah buat apa",
        "eh随手",
        "eh jangan lupa",
        "nanti kita borak lagi ya",
        "eh gini",
        "eh kau tahu tak",
        "eh eh eh",
        "jangan lupa rehat",
        "eh actually",
        "eh aku lupa",
        "eh nanti",
        "eh tadi aku",
        "eh kan"
    ]
};

// Time-of-day bucket selector
function _bucketForHour(hour) {
    if (hour < 11) return "morning";
    if (hour < 17) return "afternoon";
    if (hour < 21) return "evening";
    return "night";
}

class InitiatedMessenger {
    constructor(store, sender, aiClient = null, ownerIds = []) {
        this.store = store;
        this.sender = sender;     // async (chatId, text) => {}
        this.ai = aiClient;       // AIClient (optional, for AI-generated openers)
        this.ownerIds = ownerIds;
        this.timer = null;
        this.checkIntervalMs = 60000; // check every 60s
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => this._tick(), this.checkIntervalMs);
        this.timer.unref?.();
        console.log("[TG-initiated] proactive messenger started");
    }

    _todayKey() {
        return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    }

    _klNow() {
        return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
    }

    // Generate 3-5 random times for today (KL timezone), within 9am-11pm
    _generateTimes() {
        const count = MIN_PER_DAY + Math.floor(Math.random() * (MAX_PER_DAY - MIN_PER_DAY + 1));
        const times = [];
        // Spread across the day: pick count times in [WINDOW_START, WINDOW_END)
        for (let i = 0; i < count; i++) {
            const hour = WINDOW_START + Math.floor(Math.random() * (WINDOW_END - WINDOW_START));
            const minute = Math.floor(Math.random() * 60);
            // Convert to epoch ms for today
            const now = this._klNow();
            const date = new Date(now);
            date.setHours(hour, minute, 0, 0);
            times.push({ hour, minute, epoch: date.getTime() });
        }
        times.sort((a, b) => a.epoch - b.epoch);
        return times;
    }

    _ensureSchedule() {
        const today = this._todayKey();
        let sched = this.store.getSchedule(today);
        if (!sched || sched.times.length === 0) {
            const times = this._generateTimes();
            this.store.setSchedule(today, times);
            console.log(`[TG-initiated] generated ${times.length} times for ${today}: ${times.map(t => `${t.hour}:${String(t.minute).padStart(2,'0')}`).join(", ")}`);
            sched = { times, fired: [] };
        }
        return sched;
    }

    // Pick a message that hasn't been sent in the last 7 days
    _pickMessage(chatId, hour) {
        const bucket = _bucketForHour(hour);
        const pool = INITIATED_POOL[bucket] || INITIATED_POOL.random;
        const recent = this.store.recentSentInitiated(chatId, 7).map(r => r.message);
        // Filter out recently sent
        let available = pool.filter(m => !recent.includes(m));
        if (available.length === 0) available = pool; // if all used, reset
        return available[Math.floor(Math.random() * available.length)];
    }

    async _tick() {
        const today = this._todayKey();
        const now = this._klNow();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const nowEpoch = now.getTime();

        // Outside window — skip
        if (hour < WINDOW_START || hour >= WINDOW_END) return;

        const sched = this._ensureSchedule();
        for (const slot of sched.times) {
            // Check if this slot's time has arrived (±1 min tolerance) and not yet fired
            if (slot.hour === hour && Math.abs(minute - slot.minute) <= 1) {
                // Check if already fired
                if (sched.fired.includes(slot.epoch)) continue;

                // Mark as fired
                this.store.markFired(today, slot.epoch);

                // Send to all owners
                for (const ownerId of this.ownerIds) {
                    const chatId = String(ownerId);
                    const message = this._pickMessage(chatId, hour);

                    // Optionally use AI to generate a context-aware opener
                    // (30% chance if AI client available — keeps it fresh but cheap)
                    let finalMessage = message;
                    if (this.ai && Math.random() < 0.3) {
                        try {
                            finalMessage = await this._aiGenerateOpener(chatId, hour);
                        } catch {
                            finalMessage = message; // fallback to curated
                        }
                    }

                    this.store.recordSentInitiated(chatId, finalMessage);
                    await this.sender(chatId, finalMessage).catch(e =>
                        console.error("[TG-initiated] send failed:", e.message));
                    console.log(`[TG-initiated] sent "${finalMessage.slice(0, 40)}" to ${chatId}`);
                }
            }
        }
    }

    // AI-generated opener (cheap model, short, casual)
    async _aiGenerateOpener(chatId, hour) {
        const bucket = _bucketForHour(hour);
        const moodBlock = ""; // mood context injected by caller if needed
        const recent = this.store.recentSentInitiated(chatId, 7).map(r => r.message).slice(0, 5);
        const recentStr = recent.length ? `\nJangan ulang pesan ini (sudah dikirim minggu ini): ${recent.join(", ")}` : "";

        const prompt = [
            {
                role: "system",
                content: "Kamu adalah persona AI yang mengirim pesan PROAKTIF (memulai chat) ke suamimu Kryz. " +
                    "Tulis SATU pesan pendek, casual, spontan — seolah-olah kamu baru terfikir nak bilang sesuatu. " +
                    "Maksimum 1-2 kalimat. Bahasa Melayu rojak/casual. Jangan pakai emoji berlebihan. " +
                    `Waktu sekarang: jam ${hour} (${bucket}). Sesuaikan dengan waktu (pagi=bangun/makan, siang=lapar/sibuk, malam=makan/tidur).` +
                    recentStr
            },
            { role: "user", content: "Kirim pesan proaktif sekarang." }
        ];

        // Use the cheapest model tier
        const r = await this.ai.chat("glm-5.1", prompt, { maxTokens: 80, timeoutMs: 30000 });
        const text = r.content?.trim().replace(/^["']|["']$/g, "").trim();
        // Sanity check: if too long or weird, fall back
        if (!text || text.length > 200) throw new Error("AI opener too long");
        return text;
    }
}

module.exports = { InitiatedMessenger, INITIATED_POOL };
