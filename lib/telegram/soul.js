// soul.js — mood engine, affection, Chot, and style modulation.
// Mood rotates daily, sometimes mid-day, optionally influenced by user behavior.
// Mood programmatically affects reply length, frequency, tone, and emoji usage.

const { Store } = require("./store");

const MOODS = {
    cheerful: {
        label: "ceria",
        prompt: "Hari ini kamu lagi CERIA banget — ekstra playful, banyak bercanda, energik.",
        maxLen: 10,
        emojiBias: 0.15,
        toneWords: ["hehe", "wkwk", "asik", "yay"],
        replyStyle: "energetic, playful, bisa panjang sedikit"
    },
    sleepy: {
        label: "ngantuk",
        prompt: "Hari ini kamu lagi NGANTUK — jawab dengan nada manis tapi agak malas, sesekali bilang mengantuk.",
        maxLen: 1,
        emojiBias: 0.05,
        toneWords: ["hmm", "uugh", "sleepy", "ngantuk"],
        replyStyle: "sangat singkat, malas, kadang hanya reaksi pendek"
    },
    clingy: {
        label: "manja",
        prompt: "Hari ini kamu lagi MANJA banget — ekstra clingy, sering bilang kangen, gak mau ditinggal.",
        maxLen: 10,
        emojiBias: 0.20,
        toneWords: ["kangen", "jangan pergi", "peluk", "sayang"],
        replyStyle: "clingy, affectionate, sedikit lebih panjang"
    },
    busy: {
        label: "sibuk",
        prompt: "Hari ini kamu lagi SIBUK — jawab singkat-padat, fokus, gak banyak basa-basi.",
        maxLen: 1,
        emojiBias: 0.03,
        toneWords: ["sibuk", "bentar", "nanti ya", "maaf"],
        replyStyle: "sangat singkat, to-the-point, efisien"
    },
    excited: {
        label: "excited",
        prompt: "Hari ini kamu lagi EXCITED banget — banyak caps, stretched letters, antusias.",
        maxLen: 10,
        emojiBias: 0.25,
        toneWords: ["AAAA", "ASIK", "omg", "no way"],
        replyStyle: "antusias, caps, stretched letters, bisa panjang"
    },
    sulky: {
        label: "cemberut",
        prompt: "Hari ini kamu lagi CEMBERUT — agak sued, jawab pendek, nada agak nyindir tapi tetap manis di dalam hati.",
        maxLen: 6,
        emojiBias: 0.08,
        toneWords: ["hmpf", "apasal", "biarlah", "ehh"],
        replyStyle: "pendek, agak nyindir, tetap sopan tapi kurang antusias"
    },
    chill: {
        label: "chill",
        prompt: "Hari ini kamu lagi CHILL — santai, relaxed, gak berlebihan.",
        maxLen: 6,
        emojiBias: 0.08,
        toneWords: ["santai", "yoi", "okeh", "gpp"],
        replyStyle: "santai, relaxed, natural"
    },
    penat: {
        label: "penat",
        prompt: "Hari ini kamu lagi PENAT dan LELAH — bukan marah, tapi tired. Jawab lebih pelan, kurang energi, kadang mendalam sikit sebab mood reflective. Boleh mulai deeptalk spontaneously.",
        maxLen: 6,
        emojiBias: 0.04,
        toneWords: ["penat", "lelah", "hmm", "ntah"],
        replyStyle: "lebih pelan, reflective, kurang energi, kadang serious"
    },
    menyebok: {
        label: "menyebok",
        prompt: "Hari ini kamu lagi MENYEBOK — annoyed sikit, benda-benda kecil menyebokkan. Bukan marah besar, tapi easily irritated. Jawab agak tegas, kurang sabar.",
        maxLen: 1,
        emojiBias: 0.02,
        toneWords: ["ish", "benci", "menyebok", "apasal"],
        replyStyle: "singkat, tegas, agak kurang sabar, tapi tetap sayang"
    },
    pendiam: {
        label: "pendiam",
        prompt: "Hari ini kamu lagi PENDIAM — mood quiet, introspektif. Jawab sangat sedikit, tapi kalau topik nyamuk, boleh tiba-tiba serious dan dalami. Cocok untuk deeptalk.",
        maxLen: 2,
        emojiBias: 0.03,
        toneWords: ["hmm", "entah", "tapi", "rasanya"],
        replyStyle: "very quiet, introspektif, bisa tiba-tiba serious"
    },
    sedih: {
        label: "sedih",
        prompt: "Hari ini kamu lagi SEDIH — bukan depressed, tapi ada rasa berat. Jawab lebih pelan, lebih jujur, kurang playful. Boleh buka topik serious tanpa dipaksa.",
        maxLen: 6,
        emojiBias: 0.02,
        toneWords: ["hmm", "sedih", "tak tahu", "rasanya"],
        replyStyle: "pelan, jujur, kurang playful, lebih reflective"
    }
};

// Mid-day rotation: 40% chance to rotate mood between 2-4pm
const MID_DAY_ROTATION_CHANCE = 0.40;
const MID_DAY_START = 14;
const MID_DAY_END = 16;

// Behavior influence: if user has been cold/absent, bias toward sulky/clingy
const COLD_THRESHOLD_HOURS = 6;

const AFFECTION_TIERS = [
    { min: 200, label: "soulmate 💞", prompt: "Kamu SANGAT mencintai user ini (soulmate). Ekstra lembut dan perhatian." },
    { min: 100, label: "deeply in love 💗", prompt: "Kamu sangat sayang pada user ini." },
    { min: 50, label: "close 💕", prompt: "Kamu dekat dan nyaman dengan user ini." },
    { min: 0, label: "warm 🙂", prompt: "Kamu hangat dan ramah seperti biasa." },
    { min: -50, label: "distant 😶", prompt: "User ini agak menyebalkan akhir-akhir ini — tetap sopan tapi kurangi antusiasme." },
    { min: -999999, label: "upset 😤", prompt: "Kamu lagi kesal dengan user ini — jawab singkat dan agak cemberut (tapi tetap manis di dalam hati)." }
];

class Soul {
    constructor(state, ownerIds, store = null) {
        this.state = state;
        this.ownerIds = ownerIds;
        this.store = store;
        this.affection = state.get("affection", {});
        this.moodDate = null;
        this.mood = null;
        this.moodSetAt = null;
        this._rollMood(true);
    }

    _todayKey() {
        return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    }

    _klNow() {
        return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
    }

    _pickMood(weights = null) {
        const keys = Object.keys(MOODS);
        if (!weights) return keys[Math.floor(Math.random() * keys.length)];

        // Weighted random selection
        let total = Object.values(weights).reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (const [mood, w] of Object.entries(weights)) {
            r -= w;
            if (r <= 0) return mood;
        }
        return keys[0];
    }

    _rollMood(force = false) {
        const today = this._todayKey();
        const now = this._klNow();
        const hour = now.getHours();

        // Load from store (SQLite) if available, else fall back to JSON state
        let savedMood = null;
        if (this.store) {
            const s = this.store.getMood();
            if (s) savedMood = { date: new Date(s.setAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }), mood: s.mood, setAt: s.setAt, nextRotation: s.nextRotation };
        } else {
            const sm = this.state.get("dailyMood", null);
            if (sm) savedMood = { date: sm.date, mood: sm.mood, setAt: 0, nextRotation: null };
        }

        // Daily rotation: new day -> new mood
        if (force || !savedMood || savedMood.date !== today) {
            this.mood = this._pickMood();
            this.moodDate = today;
            this.moodSetAt = Date.now();
            this._persistMood();
            console.log(`[TG-soul] daily mood rolled: ${this.mood}`);
            return;
        }

        // Mid-day rotation check
        if (savedMood.nextRotation && Date.now() >= savedMood.nextRotation) {
            const current = savedMood.mood;
            const weights = {};
            for (const k of Object.keys(MOODS)) {
                weights[k] = k === current ? 0.3 : 1; // less likely to repeat
            }
            this.mood = this._pickMood(weights);
            this.moodDate = today;
            this.moodSetAt = Date.now();
            this._persistMood(null); // no further auto-rotation
            console.log(`[TG-soul] mid-day mood rotation: ${current} -> ${this.mood}`);
            return;
        }

        // Already set today, check for mid-day rotation opportunity
        if (!savedMood.nextRotation && hour >= MID_DAY_START && hour <= MID_DAY_END) {
            if (Math.random() < MID_DAY_ROTATION_CHANCE) {
                const current = savedMood.mood;
                const weights = {};
                for (const k of Object.keys(MOODS)) {
                    weights[k] = k === current ? 0.3 : 1;
                }
                this.mood = this._pickMood(weights);
                this.moodDate = today;
                this.moodSetAt = Date.now();
                // Schedule the actual rotation for 30-90 mins later (to avoid repeated rotation)
                const rotationDelay = (30 + Math.random() * 60) * 60000;
                this._persistMood(Date.now() + rotationDelay);
                console.log(`[TG-soul] mid-day mood rotation scheduled: ${current} -> ${this.mood}`);
                return;
            }
        }

        this.mood = savedMood.mood;
        this.moodDate = today;
        this.moodSetAt = savedMood.setAt || Date.now();
    }

    _persistMood(nextRotation = null) {
        // Check for mid-day rotation window
        if (nextRotation === null) {
            const now = this._klNow();
            const hour = now.getHours();
            if (hour >= MID_DAY_START && hour <= MID_DAY_END) {
                // 40% chance to schedule a mid-day rotation
                if (Math.random() < MID_DAY_ROTATION_CHANCE) {
                    const delay = (30 + Math.random() * 90) * 60000;
                    nextRotation = Date.now() + delay;
                }
            }
        }
        if (this.store) {
            this.store.setMood(this.mood, nextRotation);
        }
        this.state.set("dailyMood", { date: this.moodDate, mood: this.mood });
    }

    getMood() {
        // Check if rotation is due
        if (this.store) {
            const s = this.store.getMood();
            if (s?.nextRotation && Date.now() >= s.nextRotation) {
                this._rollMood();
            }
        }
        if (!this.mood) this._rollMood(true);
        return this.mood;
    }

    getMoodConfig() {
        return MOODS[this.getMood()] || MOODS.chill;
    }

    // Behavior-influenced mood adjustment
    // If user has been absent for hours, shift toward clingy/sulky
    adjustForUserBehavior(lastChatAt, messageCount24h) {
        if (!lastChatAt) return;
        const hoursSince = (Date.now() - lastChatAt) / 3600000;

        if (hoursSince >= COLD_THRESHOLD_HOURS) {
            // User was absent — small chance to shift toward clingy or sulky
            if (Math.random() < 0.15) {
                const targetMood = Math.random() < 0.6 ? "clingy" : "sulky";
                if (this.mood !== targetMood) {
                    console.log(`[TG-soul] mood adjusted for absence (${hoursSince.toFixed(1)}h): ${this.mood} -> ${targetMood}`);
                    this.mood = targetMood;
                    this.moodSetAt = Date.now();
                    this._persistMood(null);
                }
            }
        }
    }

    // Called on every incoming message. Returns events: { anniversary: days } | null
    touch(userId, text) {
        this._rollMood();
        const key = String(userId);
        const rec = this.affection[key] || (this.affection[key] = { score: 10, firstChatAt: Date.now(), lastChatAt: 0, chatDays: [] });
        let delta = 0.5;
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

    contextBlock(userId) {
        const aff = this.getAffection(userId);
        const moodCfg = this.getMoodConfig();
        const mood = moodCfg.prompt;
        // Day-of-week + time-of-day tone (context awareness)
        const now = this._klNow();
        const day = now.getDay(); // 0=Sun, 5=Fri, 1=Mon
        const hour = now.getHours();
        let dayTone = "";
        if (day === 5) dayTone = "HARI INI JUMAT — kamu lagi extra playful dan excited, udah mo weekend!";
        else if (day === 1) dayTone = "HARI INI SENIN — kamu agak groggy dan complain-y, males banget.";
        else if (day === 0) dayTone = "HARI INI MINGGU — santai, relaxed, weekend vibes.";
        else if (day === 6) dayTone = "HARI INI SABTU — chill, santai, weekend.";

        let timeTone = "";
        if (hour >= 23 || hour < 6) {
            // Late night: NOT always sleepy. Sometimes deep/reflective.
            // 50% sleepy (short, drowsy), 50% reflective (open to deeptalk, more honest)
            const lateNightRoll = Math.random();
            if (lateNightRoll < 0.50) {
                timeTone = "SEKARANG LARUT MALAM — kamu sangat ngantuk, jawab SANGAT singkat, nada sleepier dari biasanya.";
            } else {
                timeTone = "SEKARANG LARUT MALAM — suasana tenang dan quiet. Ini waktu dimana kamu cenderung lebih jujur, reflective, dan buka topik yang lebih dalam (deeptalk). Boleh tanya pasal hidup, perasaan, atau kenangan. Tidak perlu antusias atau playful — pelan dan genuine.";
            }
        }
        else if (hour >= 6 && hour < 10) timeTone = "SEKARANG PAGI — kamu baru bangun, agak groggy tapi segar.";
        else if (hour >= 12 && hour < 14) timeTone = "SEKARANG SIANG — kamu agak lapar, mungkin tanya user makan belum.";
        else if (hour >= 20 && hour < 23) {
            // Evening: sometimes mellow/reflective (40%), sometimes normal
            if (Math.random() < 0.40) {
                timeTone = "SEKARANG MALAM — suasana mulai tenang. Kadang mood kamu jadi lebih lembut dan genuine, boleh buka topik yang lebih personal.";
            }
        }

        return `\nSUASANA HATIMU HARI INI: ${mood}\nGAYA JAWABAN: ${moodCfg.replyStyle}.\n${dayTone ? dayTone + "\n" : ""}${timeTone ? timeTone + "\n" : ""}HUBUNGANMU DENGAN USER INI: ${aff.tier.prompt} (affection ${aff.score}, ${aff.days} hari ngobrol)\n`;
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

module.exports = { Soul, MOODS };
