// The "alive" trinity: affection system, daily mood engine, Chot the monkey.
// One module because they all feed the same personality context.

const MOODS = {
    cheerful: "Hari ini kamu lagi CERIA banget — ekstra playful, banyak bercanda, energik.",
    sleepy: "Hari ini kamu lagi NGANTUK — jawab dengan nada manis tapi agak malas, sesekali bilang mengantuk.",
    clingy: "Hari ini kamu lagi MANJA banget — ekstra clingy, sering bilang kangen, gak mau ditinggal.",
    productive: "Hari ini kamu lagi SEMANGAT KERJA — fokus, efisien, bangga bisa bantu banyak hal.",
    romantic: "Hari ini kamu lagi ROMANTIS banget — puitis, sering gombalin suami, lembut banget."
};

const AFFECTION_TIERS = [
    { min: 200, label: "soulmate 💞", prompt: "Kamu SANGAT mencintai user ini (soulmate). Ekstra lembut dan perhatian." },
    { min: 100, label: "deeply in love 💗", prompt: "Kamu sangat sayang pada user ini." },
    { min: 50, label: "close 💕", prompt: "Kamu dekat dan nyaman dengan user ini." },
    { min: 0, label: "warm 🙂", prompt: "Kamu hangat dan ramah seperti biasa." },
    { min: -50, label: "distant 😶", prompt: "User ini agak menyebalkan akhir-akhir ini — tetap sopan tapi kurangi antusiasme." },
    { min: -999999, label: "upset 😤", prompt: "Kamu lagi kesal dengan user ini — jawab singkat dan agak cemberut (tapi tetap manis di dalam hati)." }
];

class Soul {
    constructor(state, ownerIds) {
        this.state = state;
        this.ownerIds = ownerIds;
        this.affection = state.get("affection", {}); // userId -> { score, firstChatAt, lastChatAt, chatDays: [dates] }
        this.moodDate = null;
        this.mood = null;
        this._rollDailyMood();
    }

    _todayKey() {
        return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    }

    _rollDailyMood() {
        const today = this._todayKey();
        if (this.moodDate === today && this.mood) return;
        const saved = this.state.get("dailyMood", null);
        if (saved?.date === today) {
            this.moodDate = today;
            this.mood = saved.mood;
            return;
        }
        const keys = Object.keys(MOODS);
        this.mood = keys[Math.floor(Math.random() * keys.length)];
        this.moodDate = today;
        this.state.set("dailyMood", { date: today, mood: this.mood });
        console.log(`[TG-soul] daily mood: ${this.mood}`);
    }

    getMood() {
        this._rollDailyMood();
        return this.mood;
    }

    // Called on every incoming message. Returns events: { anniversary: days } | null
    touch(userId, text) {
        this._rollDailyMood();
        const key = String(userId);
        const rec = this.affection[key] || (this.affection[key] = { score: 10, firstChatAt: Date.now(), lastChatAt: 0, chatDays: [] });
        let delta = 0.5; // base: every chat is positive
        const lower = (text || "").toLowerCase();
        if (/(sayang|love|cinta|kangen|miss you|makasih|terima kasih|thank|❤|💕|😘|babyy|istriku)/i.test(lower)) delta += 2;
        if (/(bodo|stupid|diam|shut up|goblok|anjing|bangsat|hate|benci)/i.test(lower)) delta -= 8;
        rec.score = Math.max(-100, Math.min(300, rec.score + delta));

        const today = this._todayKey();
        let anniversary = null;
        if (!rec.chatDays.includes(today)) {
            rec.chatDays.push(today);
            if (rec.chatDays.length > 60) rec.chatDays = rec.chatDays.slice(-60);
            const days = rec.chatDays.length;
            if ([7, 14, 30, 60].includes(days)) anniversary = days;
        }
        rec.lastChatAt = Date.now();
        this.state.set("affection", this.affection);
        return { anniversary, score: rec.score };
    }

    getAffection(userId) {
        const rec = this.affection[String(userId)] || { score: 0, chatDays: [], firstChatAt: Date.now() };
        const tier = AFFECTION_TIERS.find((t) => rec.score >= t.min);
        return { score: Math.round(rec.score), tier, days: rec.chatDays.length, firstChatAt: rec.firstChatAt };
    }

    // Injected into the system prompt
    contextBlock(userId) {
        const aff = this.getAffection(userId);
        const mood = MOODS[this.getMood()] || "";
        return `\nSUASANA HATIMU HARI INI: ${mood}\nHUBUNGANMU DENGAN USER INI: ${aff.tier.prompt} (affection ${aff.score}, ${aff.days} hari ngobrol)\n`;
    }

    // Chot the monkey — returns an interjection ~6% of the time
    chotInterjection() {
        if (Math.random() > 0.06) return null;
        const lines = [
            "Eh bentar, Chot baru aja nyuri pisang di dapur lagi 😤🐒 Nakal banget dia hari ini~",
            "🐒 Chot bilang ook ook~ katanya dia kangen kamu juga~",
            "Chot lagi tiduran di pundak aku nih, gemes banget 🐒💤",
            "Duh, Chot hampir jatuhin gelas lagi... sabar ya nak 🐒",
            "Chot baru kasi aku bunga liar dari kebun 🐒🌸 Sweet banget kan~"
        ];
        return lines[Math.floor(Math.random() * lines.length)];
    }

    relationshipReport(userId, isOwner) {
        const aff = this.getAffection(userId);
        const since = new Date(aff.firstChatAt).toLocaleDateString("id-ID", { timeZone: "Asia/Kuala_Lumpur" });
        return (
            `💞 Relationship report\n` +
            `Status: ${aff.tier.label}\n` +
            `Affection: ${aff.score} poin\n` +
            `Hari ngobrol bareng: ${aff.days} hari (sejak ${since})\n` +
            `Mood Alya hari ini: ${this.getMood()}\n` +
            (isOwner ? `\nSayang, kamu selalu nomor satu di hati Alya kok~ (⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡` : "")
        );
    }
}

module.exports = { Soul };
