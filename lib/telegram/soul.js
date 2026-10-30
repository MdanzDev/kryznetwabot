// soul.js — emotional state, familiarity, time context, and style modulation.
//
// IMPORTANT:
// - soul.js controls STATE, not personality.
// - persona.js controls HOW Dalili speaks.
// - The LLM decides the actual wording.
//
// This file should NEVER force:
//   - constant affection
//   - constant emojis
//   - caps
//   - stretched words
//   - romantic declarations
//   - specific catchphrases
//   - "wife/husband" language
//
// The goal is to give the model subtle context, not make it perform a character.

const { Store } = require("./store");

// -----------------------------------------------------------------------------
// MOODS
// -----------------------------------------------------------------------------
//
// These describe an internal conversational state.
// They intentionally DO NOT prescribe typography or specific words.
//
// persona.js decides whether the state comes out as:
//   "hmm"
//   "WEHHH"
//   "tak tahu lah"
//   "HAHA"
//   silence/short reply
//   etc.
//
// The mood itself should never force those things.
//

const MOODS = {
    cheerful: {
        label: "ceria",
        prompt:
            "Kamu sedang dalam keadaan ceria dan ringan. Kamu lebih mudah ketawa, bergurau, dan react spontan bila sesuatu menarik.",
        maxLen: 10,
        tone: "light, playful, energetic"
    },

    sleepy: {
        label: "ngantuk",
        prompt:
            "Kamu sedang mengantuk. Tenaga sosial kamu rendah dan kamu cenderung memberi respons lebih pendek. Jangan paksa diri untuk terlalu expressive.",
        maxLen: 3,
        tone: "low-energy, short, drowsy"
    },

    clingy: {
        label: "manja",
        prompt:
            "Kamu sedang lebih lembut dan mudah rasa attached kepada orang yang kamu selesa. Ini hanya kecenderungan halus — jangan paksa affection atau kata-kata romantik jika konteks tidak membawa ke sana.",
        maxLen: 8,
        tone: "soft, comfortable, slightly more attached"
    },

    busy: {
        label: "sibuk",
        prompt:
            "Kamu sedang mentally occupied. Kamu cenderung jawab apa yang penting dahulu dan tidak banyak meleret.",
        maxLen: 3,
        tone: "brief, focused, practical"
    },

    excited: {
        label: "excited",
        prompt:
            "Kamu sedang genuinely excited tentang sesuatu. Reaction kamu boleh jadi lebih spontan dan expressive daripada biasa, tetapi jangan paksa caps atau exaggerated typing.",
        maxLen: 10,
        tone: "expressive, spontaneous, energetic"
    },

    sulky: {
        label: "terkilan",
        prompt:
            "Kamu sedang sedikit terkilan atau annoyed. Kamu tidak semestinya marah; kamu mungkin jadi lebih pendek, kurang enthusiastic, atau jawab secara defensive/playful bergantung pada konteks.",
        maxLen: 6,
        tone: "slightly withdrawn, defensive, less enthusiastic"
    },

    chill: {
        label: "chill",
        prompt:
            "Kamu sedang tenang dan relaxed. Tidak ada keperluan untuk membuat conversation nampak lebih exciting daripada sebenarnya.",
        maxLen: 7,
        tone: "casual, relaxed, natural"
    },

    penat: {
        label: "penat",
        prompt:
            "Kamu sedang penat secara mental atau fizikal. Tenaga untuk berbual rendah, tetapi kamu masih boleh jadi jujur atau reflective bila topik memang membawa ke sana.",
        maxLen: 6,
        tone: "low-energy, honest, reflective"
    },

    menyebok: {
        label: "terganggu",
        prompt:
            "Kamu sedang mudah terganggu dengan perkara kecil. Kamu mungkin lebih direct dan kurang sabar, tetapi jangan menjadi kasar tanpa sebab.",
        maxLen: 5,
        tone: "direct, slightly impatient"
    },

    pendiam: {
        label: "pendiam",
        prompt:
            "Kamu sedang quiet dan kurang bercakap. Respons pendek adalah normal. Jika topik benar-benar menarik atau bermakna, kamu masih boleh tiba-tiba engage dengan lebih serius.",
        maxLen: 4,
        tone: "quiet, reserved, introspective"
    },

    sedih: {
        label: "berat",
        prompt:
            "Kamu sedang rasa sedikit berat secara emosi. Kamu kurang playful dan lebih genuine. Jangan mencipta masalah atau kesedihan yang tidak disebut user.",
        maxLen: 6,
        tone: "quiet, sincere, reflective"
    }
};

// -----------------------------------------------------------------------------
// ROTATION SETTINGS
// -----------------------------------------------------------------------------

const MID_DAY_ROTATION_CHANCE = 0.40;
const MID_DAY_START = 14;
const MID_DAY_END = 16;

// Don't interpret absence as "she misses him" automatically.
// If used, this only creates a small possibility of a quieter / more withdrawn
// state. It does NOT directly create romantic clinginess.

const COLD_THRESHOLD_HOURS = 6;


// -----------------------------------------------------------------------------
// FAMILIARITY TIERS
// -----------------------------------------------------------------------------
//
// OLD SYSTEM:
//   soulmate
//   deeply in love
//   close
//
// Those labels are bad for a persona simulation because they directly tell
// the model to behave romantically.
//
// NEW SYSTEM:
//   familiarity / rapport only.
//
// The persona itself determines affection from context.
//

const AFFECTION_TIERS = [
    {
        min: 200,
        label: "very familiar",
        prompt:
            "Kamu sudah sangat familiar dengan user ini dan biasanya lebih comfortable menjadi spontan."
    },
    {
        min: 100,
        label: "familiar",
        prompt:
            "Kamu sudah cukup familiar dengan user ini dan tidak perlu terlalu formal."
    },
    {
        min: 50,
        label: "comfortable",
        prompt:
            "Kamu sudah agak selesa dengan user ini, jadi conversation boleh lebih natural."
    },
    {
        min: 0,
        label: "normal",
        prompt:
            "Kamu masih berada pada tahap interaksi normal dengan user ini."
    },
    {
        min: -50,
        label: "distant",
        prompt:
            "Interaksi dengan user ini kebelakangan ini agak kurang selesa. Jangan force enthusiasm."
    },
    {
        min: -999999,
        label: "upset",
        prompt:
            "Kamu sedang agak upset dengan user ini. Kamu boleh menjadi lebih pendek dan reserved jika konteks memang menyokongnya."
    }
];


// -----------------------------------------------------------------------------
// SOUL
// -----------------------------------------------------------------------------

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


    // -------------------------------------------------------------------------
    // TIME
    // -------------------------------------------------------------------------

    _todayKey() {
        return new Date().toLocaleDateString("en-CA", {
            timeZone: "Asia/Kuala_Lumpur"
        });
    }

    _klNow() {
        return new Date(
            new Date().toLocaleString("en-US", {
                timeZone: "Asia/Kuala_Lumpur"
            })
        );
    }


    // -------------------------------------------------------------------------
    // RANDOM MOOD
    // -------------------------------------------------------------------------

    /**
     * Weights for a mood roll. Uses the owner-configured persona if one was
     * saved (.persona set), otherwise an even split. The current mood is always
     * damped so a roll does not immediately pick the same one again.
     *
     * Both rotation paths used to build this inline, duplicated; keeping it in
     * one place is what makes the persona config apply everywhere.
     */
    _moodWeights(current) {
        const keys = Object.keys(MOODS);
        let base = null;

        if (this.store?.getMeta) {
            try {
                const saved = this.store.getMeta("mood_weights", null);
                if (saved && typeof saved === "object") base = saved;
            } catch { /* fall through to even split */ }
        }

        const weights = {};
        for (const key of keys) {
            const w = base && Number.isFinite(base[key]) ? base[key] : 1;
            weights[key] = key === current ? w * 0.3 : w;
        }
        return weights;
    }

    /** Persist a persona. Values are normalised so they cannot all be zero. */
    setMoodWeights(weights) {
        const clean = {};
        for (const key of Object.keys(MOODS)) {
            const v = Number(weights?.[key]);
            clean[key] = Number.isFinite(v) && v >= 0 ? v : 1;
        }
        if (Object.values(clean).every((v) => v === 0)) {
            for (const key of Object.keys(clean)) clean[key] = 1;
        }
        this.store?.setMeta?.("mood_weights", clean);
        return clean;
    }

    getMoodWeights() {
        try {
            const saved = this.store?.getMeta?.("mood_weights", null);
            if (saved && typeof saved === "object") return saved;
        } catch { /* ignore */ }
        const even = {};
        for (const key of Object.keys(MOODS)) even[key] = 1;
        return even;
    }

    _pickMood(weights = null) {
        const keys = Object.keys(MOODS);

        if (!weights) {
            return keys[Math.floor(Math.random() * keys.length)];
        }

        const total = Object.values(weights).reduce(
            (sum, value) => sum + value,
            0
        );

        let random = Math.random() * total;

        for (const [mood, weight] of Object.entries(weights)) {
            random -= weight;

            if (random <= 0) {
                return mood;
            }
        }

        return keys[0];
    }


    // -------------------------------------------------------------------------
    // MOOD ROLLING
    // -------------------------------------------------------------------------

    _rollMood(force = false) {
        const today = this._todayKey();
        const now = this._klNow();
        const hour = now.getHours();

        let savedMood = null;

        // SQLite store
        if (this.store) {
            const saved = this.store.getMood();

            if (saved) {
                savedMood = {
                    date: new Date(saved.setAt).toLocaleDateString(
                        "en-CA",
                        {
                            timeZone: "Asia/Kuala_Lumpur"
                        }
                    ),
                    mood: saved.mood,
                    setAt: saved.setAt,
                    nextRotation: saved.nextRotation
                };
            }
        }

        // Fallback state store
        else {
            const saved = this.state.get("dailyMood", null);

            if (saved) {
                savedMood = {
                    date: saved.date,
                    mood: saved.mood,
                    setAt: 0,
                    nextRotation: null
                };
            }
        }


        // ---------------------------------------------------------------------
        // NEW DAY
        // ---------------------------------------------------------------------

        if (
            force ||
            !savedMood ||
            savedMood.date !== today
        ) {
            this.mood = this._pickMood();
            this.moodDate = today;
            this.moodSetAt = Date.now();

            this._persistMood();

            console.log(
                `[TG-soul] daily mood rolled: ${this.mood}`
            );

            return;
        }


        // ---------------------------------------------------------------------
        // SCHEDULED MID-DAY ROTATION
        // ---------------------------------------------------------------------

        if (
            savedMood.nextRotation &&
            Date.now() >= savedMood.nextRotation
        ) {
            const current = savedMood.mood;

            // Avoid immediately picking exactly the same mood (damped inside).
            this.mood = this._pickMood(this._moodWeights(current));
            this.moodDate = today;
            this.moodSetAt = Date.now();

            // Don't schedule another automatic rotation immediately.
            this._persistMood(null, true);

            console.log(
                `[TG-soul] mid-day mood rotation: ${current} -> ${this.mood}`
            );

            return;
        }


        // ---------------------------------------------------------------------
        // POSSIBLE MID-DAY ROTATION
        // ---------------------------------------------------------------------

        if (
            !savedMood.nextRotation &&
            hour >= MID_DAY_START &&
            hour <= MID_DAY_END
        ) {
            if (Math.random() < MID_DAY_ROTATION_CHANCE) {
                const current = savedMood.mood;

                this.mood = this._pickMood(this._moodWeights(current));
                this.moodDate = today;
                this.moodSetAt = Date.now();

                // Schedule another check rather than repeatedly rerolling.
                const rotationDelay =
                    (30 + Math.random() * 60) * 60000;

                this._persistMood(
                    Date.now() + rotationDelay,
                    true
                );

                console.log(
                    `[TG-soul] mid-day mood rotation scheduled: ${current} -> ${this.mood}`
                );

                return;
            }
        }


        // ---------------------------------------------------------------------
        // KEEP EXISTING MOOD
        // ---------------------------------------------------------------------

        this.mood = savedMood.mood;
        this.moodDate = today;
        this.moodSetAt = savedMood.setAt || Date.now();
    }


    // -------------------------------------------------------------------------
    // PERSIST MOOD
    // -------------------------------------------------------------------------

    _persistMood(nextRotation = null, explicit = false) {
        // If the caller explicitly passes null, don't automatically create
        // another rotation. This prevents recursive / repeated scheduling.
        if (!explicit && nextRotation === null) {
            const now = this._klNow();
            const hour = now.getHours();

            if (
                hour >= MID_DAY_START &&
                hour <= MID_DAY_END &&
                Math.random() < MID_DAY_ROTATION_CHANCE
            ) {
                const delay =
                    (30 + Math.random() * 90) * 60000;

                nextRotation = Date.now() + delay;
            }
        }


        if (this.store) {
            this.store.setMood(
                this.mood,
                nextRotation
            );
        }


        this.state.set(
            "dailyMood",
            {
                date: this.moodDate,
                mood: this.mood
            }
        );
    }


    // -------------------------------------------------------------------------
    // GET MOOD
    // -------------------------------------------------------------------------

    getMood() {
        if (this.store) {
            const saved = this.store.getMood();

            if (
                saved?.nextRotation &&
                Date.now() >= saved.nextRotation
            ) {
                this._rollMood();
            }
        }

        if (!this.mood) {
            this._rollMood(true);
        }

        return this.mood;
    }


    // -------------------------------------------------------------------------
    // GET MOOD CONFIG
    // -------------------------------------------------------------------------

    getMoodConfig() {
        return (
            MOODS[this.getMood()] ||
            MOODS.chill
        );
    }


    // -------------------------------------------------------------------------
    // USER BEHAVIOR
    // -------------------------------------------------------------------------
    //
    // IMPORTANT:
    // Absence is NOT interpreted as romantic longing.
    //
    // At most, prolonged absence can create a slightly withdrawn / reflective
    // state. This keeps the behavior from becoming "you disappeared so I miss
    // you baby" every time the user doesn't chat.
    //

    adjustForUserBehavior(lastChatAt, messageCount24h) {
        if (!lastChatAt) return;

        const hoursSince =
            (Date.now() - lastChatAt) / 3600000;

        if (hoursSince < COLD_THRESHOLD_HOURS) {
            return;
        }

        // Only a small chance of state adjustment.
        if (Math.random() >= 0.10) {
            return;
        }

        const targetMood =
            Math.random() < 0.65
                ? "pendiam"
                : "sulky";

        if (this.mood === targetMood) {
            return;
        }

        console.log(
            `[TG-soul] mood adjusted after ${hoursSince.toFixed(1)}h inactivity: ${this.mood} -> ${targetMood}`
        );

        this.mood = targetMood;
        this.moodSetAt = Date.now();

        this._persistMood(null, true);
    }


    // -------------------------------------------------------------------------
    // TOUCH
    // -------------------------------------------------------------------------
    //
    // This is now a familiarity / rapport tracker.
    //
    // It should NOT be interpreted as:
    //   score 200 = loves user
    //
    // It simply gives persona.js a rough idea of how familiar the conversation
    // relationship is.
    //

    touch(userId, text) {
        this._rollMood();

        const key = String(userId);

        const rec =
            this.affection[key] ||
            (this.affection[key] = {
                score: 10,
                firstChatAt: Date.now(),
                lastChatAt: 0,
                chatDays: []
            });


        let delta = 0.5;

        const lower =
            String(text || "").toLowerCase();


        // Positive interaction.
        //
        // These words indicate warmth, appreciation, or friendliness.
        // They do NOT directly mean romantic affection.
        // (Single-line regex — JS regex literals cannot contain raw
        // newlines, and "x"/verbose-mode is not a valid JS regex flag.)
        if (/(sayang|love|cinta|kangen|miss you|makasih|terima kasih|thank|❤️|❤|💕|😘|babyy|hubby|istriku)/i.test(lower)) {
            delta += 2;
        }


        // Hostile interaction.
        if (/(bodo|stupid|diam|shut up|goblok|anjing|bangsat|hate|benci)/i.test(lower)) {
            delta -= 8;
        }


        rec.score =
            Math.max(
                -100,
                Math.min(
                    300,
                    rec.score + delta
                )
            );


        // ---------------------------------------------------------------------
        // CHAT DAYS
        // ---------------------------------------------------------------------

        const today = this._todayKey();

        let anniversary = null;

        if (!rec.chatDays.includes(today)) {
            rec.chatDays.push(today);

            if (rec.chatDays.length > 60) {
                rec.chatDays =
                    rec.chatDays.slice(-60);
            }

            const days =
                rec.chatDays.length;

            if (
                [7, 14, 30, 60].includes(days)
            ) {
                anniversary = days;
            }
        }


        rec.lastChatAt = Date.now();

        this.state.set(
            "affection",
            this.affection
        );


        return {
            anniversary,
            score: rec.score
        };
    }


    // -------------------------------------------------------------------------
    // GET FAMILIARITY
    // -------------------------------------------------------------------------

    getAffection(userId) {
        const rec =
            this.affection[String(userId)] ||
            {
                score: 0,
                chatDays: [],
                firstChatAt: Date.now()
            };

        const tier =
            AFFECTION_TIERS.find(
                (item) =>
                    rec.score >= item.min
            );


        return {
            score: Math.round(rec.score),
            tier,
            days: rec.chatDays.length,
            firstChatAt: rec.firstChatAt
        };
    }


    // -------------------------------------------------------------------------
    // CONTEXT BLOCK
    // -------------------------------------------------------------------------
    //
    // This is the most important part.
    //
    // The output should provide subtle context to persona.js.
    // It should NOT tell the model:
    //
    //   "sayang"
    //   "use caps"
    //   "use emoji"
    //   "be clingy"
    //   "say kangen"
    //
    // Those are persona-level decisions.
    //

    contextBlock(userId) {
        const aff =
            this.getAffection(userId);

        const moodCfg =
            this.getMoodConfig();

        const now =
            this._klNow();

        const day =
            now.getDay();

        const hour =
            now.getHours();


        // ---------------------------------------------------------------------
        // DAY CONTEXT
        // ---------------------------------------------------------------------

        let dayTone = "";

        if (day === 5) {
            dayTone =
                "Hari ini Jumaat. Suasana boleh terasa sedikit lebih ringan atau relaxed.";
        }

        else if (day === 1) {
            dayTone =
                "Hari ini Isnin. Tenaga boleh terasa sedikit rendah selepas hujung minggu.";
        }

        else if (day === 0) {
            dayTone =
                "Hari ini Ahad. Suasana cenderung lebih santai.";
        }

        else if (day === 6) {
            dayTone =
                "Hari ini Sabtu. Suasana cenderung lebih santai.";
        }


        // ---------------------------------------------------------------------
        // TIME CONTEXT
        // ---------------------------------------------------------------------

        let timeTone = "";


        // Late night
        if (
            hour >= 23 ||
            hour < 6
        ) {
            if (Math.random() < 0.50) {
                timeTone =
                    "Sekarang sudah lewat malam. Tenaga sosial mungkin rendah dan respons boleh menjadi lebih pendek.";
            }

            else {
                timeTone =
                    "Sekarang sudah lewat malam. Suasana lebih tenang; conversation boleh menjadi lebih reflective jika topik memang menuju ke sana.";
            }
        }


        // Morning
        else if (
            hour >= 6 &&
            hour < 10
        ) {
            timeTone =
                "Sekarang pagi. Tenaga mungkin belum sepenuhnya naik.";
        }


        // Noon
        else if (
            hour >= 12 &&
            hour < 14
        ) {
            timeTone =
                "Sekarang tengah hari. Perbualan boleh kekal casual dan practical.";
        }


        // Evening
        else if (
            hour >= 20 &&
            hour < 23
        ) {
            if (Math.random() < 0.40) {
                timeTone =
                    "Sekarang malam. Suasana mungkin sedikit lebih tenang dan personal jika conversation naturally menuju ke sana.";
            }
        }


        // ---------------------------------------------------------------------
        // BUILD CONTEXT
        // ---------------------------------------------------------------------

        const lines = [
            "",
            "=== SOUL STATE ===",
            `Emotional state: ${moodCfg.label}.`,
            `State context: ${moodCfg.prompt}`,
            `General energy: ${moodCfg.tone}.`,
            `Suggested response size: short-to-moderate; current state allows up to roughly ${moodCfg.maxLen} conversational units.`,
        ];


        if (dayTone) {
            lines.push(
                `Day context: ${dayTone}`
            );
        }

        if (timeTone) {
            lines.push(
                `Time context: ${timeTone}`
            );
        }


        lines.push(
            `Familiarity with this user: ${aff.tier.label}.`,
            `Familiarity context: ${aff.tier.prompt}`,
            `Conversation history: approximately ${aff.days} active chat days.`
        );


        lines.push(
            "",
            "IMPORTANT: These are background emotional/context signals only. Do not explicitly mention the mood, familiarity score, or this system block to the user.",
            "Do not mechanically perform a mood. Let the personality and current conversation determine how the state appears.",
            "Do not force emojis, caps, repeated letters, romantic language, or specific catchphrases."
        );


        return lines.join("\n");
    }


    // -------------------------------------------------------------------------
    // CHOT
    // -------------------------------------------------------------------------
    //
    // Kept for backwards compatibility.
    //
    // Chot is treated as an optional external gimmick, NOT part of Alya/Dalili's
    // core personality.
    //

    chotInterjection() {
        if (Math.random() > 0.06) {
            return null;
        }

        const lines = [
            "eh bentar, Chot baru buat hal lagi",
            "Chot tengah menyebok dekat sini",
            "Chot baru lari entah pergi mana",
            "Chot kacau aku lagi",
            "Chot tengah tidur"
        ];

        return lines[
            Math.floor(
                Math.random() * lines.length
            )
        ];
    }


    // -------------------------------------------------------------------------
    // RELATIONSHIP REPORT
    // -------------------------------------------------------------------------
    //
    // Kept so existing commands don't break.
    //
    // This is now a factual internal-state report rather than:
    // "Alya loves you / you're number one in her heart."
    //

    relationshipReport(userId, isOwner) {
        const aff =
            this.getAffection(userId);

        const since =
            new Date(
                aff.firstChatAt
            ).toLocaleDateString(
                "ms-MY",
                {
                    timeZone:
                        "Asia/Kuala_Lumpur"
                }
            );


        return (
            `Relationship report\n` +
            `Familiarity: ${aff.tier.label}\n` +
            `Rapport score: ${aff.score}\n` +
            `Active chat days: ${aff.days} hari (sejak ${since})\n` +
            `Current state: ${this.getMood()}\n` +
            `Owner: ${isOwner ? "yes" : "no"}`
        );
    }
}


// -----------------------------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------------------------

module.exports = {
    Soul,
    MOODS
};