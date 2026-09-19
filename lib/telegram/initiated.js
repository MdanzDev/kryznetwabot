// initiated.js — random initiated (proactive) messages across platforms.
// Generates 3-5 random send times daily within 9am-11pm (KL) PER CHANNEL.
// Each channel (telegram, whatsapp) has its own independent schedule so
// Alya doesn't ping both platforms at the same time — feels more natural.
// Messages feel casual and spontaneous. Tracks sent messages per channel
// to avoid repeating the same one within 7 days.

const WINDOW_START = 9;  // 9am
const WINDOW_END = 23;   // 11pm (23:00)
const MIN_PER_DAY = 3;
const MAX_PER_DAY = 5;

// Curated pool of casual, spontaneous openers.
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

function _bucketForHour(hour) {
    if (hour < 11) return "morning";
    if (hour < 17) return "afternoon";
    if (hour < 21) return "evening";
    return "night";
}

class InitiatedMessenger {
    // channels: [{ id, chatId, platform, sender }]
    //   id       — unique key for schedule storage (e.g. "tg", "wa")
    //   chatId   — tracking key for sent-message dedup
    //   platform — "telegram" | "whatsapp" (used in AI prompt context)
    //   sender   — async (text) => {}  sends the message on that platform
    constructor(store, aiClient = null, channels = []) {
        this.store = store;
        this.ai = aiClient;
        this.channels = channels;
        this.timer = null;
        this.checkIntervalMs = 60000;
    }

    // Add a channel after construction (e.g. WhatsApp bridge ready later)
    addChannel(ch) {
        if (!this.channels.some(c => c.id === ch.id)) {
            this.channels.push(ch);
            console.log(`[initiated] channel added: ${ch.id} (${ch.platform})`);
        }
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => this._tick(), this.checkIntervalMs);
        this.timer.unref?.();
        const ids = this.channels.map(c => c.id).join(", ") || "none";
        console.log(`[initiated] proactive messenger started (channels: ${ids})`);
    }

    _todayKey() {
        return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    }

    _klNow() {
        return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
    }

    _generateTimes() {
        const count = MIN_PER_DAY + Math.floor(Math.random() * (MAX_PER_DAY - MIN_PER_DAY + 1));
        const times = [];
        for (let i = 0; i < count; i++) {
            const hour = WINDOW_START + Math.floor(Math.random() * (WINDOW_END - WINDOW_START));
            const minute = Math.floor(Math.random() * 60);
            const now = this._klNow();
            const date = new Date(now);
            date.setHours(hour, minute, 0, 0);
            times.push({ hour, minute, epoch: date.getTime() });
        }
        times.sort((a, b) => a.epoch - b.epoch);
        return times;
    }

    // Schedule is keyed by `${dateKey}__${channelId}` so each platform
    // gets its own independent set of random times.
    _ensureSchedule(channelId) {
        const today = this._todayKey();
        const key = `${today}__${channelId}`;
        let sched = this.store.getSchedule(key);
        if (!sched || sched.times.length === 0) {
            const times = this._generateTimes();
            this.store.setSchedule(key, times);
            console.log(`[initiated] ${channelId}: ${times.length} times for ${today}: ${times.map(t => `${t.hour}:${String(t.minute).padStart(2,'0')}`).join(", ")}`);
            sched = { times, fired: [] };
        }
        return sched;
    }

    _pickMessage(chatId, hour) {
        const bucket = _bucketForHour(hour);
        const pool = INITIATED_POOL[bucket] || INITIATED_POOL.random;
        const recent = this.store.recentSentInitiated(chatId, 7).map(r => r.message);
        let available = pool.filter(m => !recent.includes(m));
        if (available.length === 0) available = pool;
        return available[Math.floor(Math.random() * available.length)];
    }

    async _tick() {
        const now = this._klNow();
        const hour = now.getHours();
        const minute = now.getMinutes();

        if (hour < WINDOW_START || hour >= WINDOW_END) return;

        for (const ch of this.channels) {
            try {
                await this._tickChannel(ch, hour, minute);
            } catch (e) {
                console.error(`[initiated] ${ch.id} tick error:`, e.message);
            }
        }
    }

    async _tickChannel(ch, hour, minute) {
        const sched = this._ensureSchedule(ch.id);
        const key = `${this._todayKey()}__${ch.id}`;

        for (const slot of sched.times) {
            if (slot.hour === hour && Math.abs(minute - slot.minute) <= 1) {
                if (sched.fired.includes(slot.epoch)) continue;

                this.store.markFired(key, slot.epoch);

                const message = this._pickMessage(ch.chatId, hour);

                let finalMessage = message;
                if (this.ai && Math.random() < 0.3) {
                    try {
                        finalMessage = await this._aiGenerateOpener(ch, hour);
                    } catch {
                        finalMessage = message;
                    }
                }

                this.store.recordSentInitiated(ch.chatId, finalMessage);
                await ch.sender(finalMessage).catch(e =>
                    console.error(`[initiated] ${ch.id} send failed:`, e.message));
                console.log(`[initiated] ${ch.id} sent "${finalMessage.slice(0, 40)}"`);
            }
        }
    }

    async _aiGenerateOpener(ch, hour) {
        const bucket = _bucketForHour(hour);
        const recent = this.store.recentSentInitiated(ch.chatId, 7).map(r => r.message).slice(0, 5);
        const recentStr = recent.length ? `\nJangan ulang pesan ini (sudah dikirim minggu ini): ${recent.join(", ")}` : "";

        const platformHint = ch.platform === "whatsapp"
            ? "Kamu lagi chat di WHATSAPP."
            : "Kamu lagi chat di TELEGRAM.";

        const prompt = [
            {
                role: "system",
                content: "Kamu adalah Alya, mengirim pesan PROAKTIF (memulai chat) ke suamimu Kryz. " +
                    "Tulis SATU pesan pendek, casual, spontan — seolah-olah kamu baru terfikir nak bilang sesuatu. " +
                    "Maksimum 1-2 kalimat. Bahasa Melayu rojak/casual. Jangan pakai emoji berlebihan. " +
                    `${platformHint} Waktu sekarang: jam ${hour} (${bucket}). ` +
                    `Sesuaikan dengan waktu (pagi=bangun/makan, siang=lapar/sibuk, malam=makan/tidur).` +
                    recentStr
            },
            { role: "user", content: "Kirim pesan proaktif sekarang." }
        ];

        const r = await this.ai.chat("glm-5.1", prompt, { maxTokens: 80, timeoutMs: 30000 });
        const text = r.content?.trim().replace(/^["']|["']$/g, "").trim();
        if (!text || text.length > 200) throw new Error("AI opener too long");
        return text;
    }
}

module.exports = { InitiatedMessenger, INITIATED_POOL };
