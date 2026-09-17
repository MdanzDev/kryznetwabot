// store.js — SQLite-backed persistence for mood, memory, and initiated messages.
// Uses node:sqlite (built into Node 22+) — zero deps, zero RAM overhead.
// WAL mode for concurrent reads, NORMAL sync for acceptable durability.

const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

class Store {
    constructor(dbPath) {
        // Ensure parent dir exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        this.db = new DatabaseSync(dbPath);
        this.db.exec("PRAGMA journal_mode = WAL");
        this.db.exec("PRAGMA synchronous = NORMAL");
        this.db.exec("PRAGMA temp_store = MEMORY");

        this._init();
    }

    _init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL,
                fact TEXT NOT NULL,
                kind TEXT DEFAULT 'long',
                created_at INTEGER NOT NULL,
                expires_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_mem_chat ON memories(chat_id, kind);

            CREATE TABLE IF NOT EXISTS summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL,
                summary TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sum_chat ON summaries(chat_id, created_at);

            CREATE TABLE IF NOT EXISTS moods (
                key TEXT PRIMARY KEY,
                mood TEXT NOT NULL,
                set_at INTEGER NOT NULL,
                next_rotation INTEGER
            );

            CREATE TABLE IF NOT EXISTS sent_initiated (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL,
                message TEXT NOT NULL,
                sent_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sent_chat ON sent_initiated(chat_id, sent_at);

            CREATE TABLE IF NOT EXISTS initiated_schedule (
                date TEXT PRIMARY KEY,
                times TEXT NOT NULL,
                fired TEXT DEFAULT '[]',
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);
    }

    // ---- meta ----
    getMeta(key, fallback = null) {
        const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
        return row ? row.value : fallback;
    }
    setMeta(key, value) {
        this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, String(value));
    }

    // ---- memories (long-term facts + short-term notes) ----
    addMemory(chatId, fact, kind = "long", expiresAt = null) {
        this.db.prepare(
            "INSERT INTO memories (chat_id, fact, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
        ).run(String(chatId), fact, kind, Date.now(), expiresAt);
    }

    listMemories(chatId, kind = null) {
        const now = Date.now();
        if (kind) {
            return this.db.prepare(
                "SELECT * FROM memories WHERE chat_id = ? AND kind = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 50"
            ).all(String(chatId), kind, now);
        }
        return this.db.prepare(
            "SELECT * FROM memories WHERE chat_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 50"
        ).all(String(chatId), now);
    }

    forgetMemory(chatId, id) {
        this.db.prepare("DELETE FROM memories WHERE id = ? AND chat_id = ?").run(id, String(chatId));
    }

    clearMemories(chatId) {
        this.db.prepare("DELETE FROM memories WHERE chat_id = ?").run(String(chatId));
    }

    dedupeMemory(chatId, fact) {
        const existing = this.listMemories(chatId, "long").map(m => m.fact.toLowerCase());
        const fl = fact.toLowerCase();
        return existing.some(e => e.includes(fl) || fl.includes(e));
    }

    // ---- conversation summaries (short-term rolling memory) ----
    addSummary(chatId, summary) {
        this.db.prepare(
            "INSERT INTO summaries (chat_id, summary, created_at) VALUES (?, ?, ?)"
        ).run(String(chatId), summary, Date.now());
        // Keep only last 10 summaries per chat
        this.db.prepare(
            "DELETE FROM summaries WHERE chat_id = ? AND id NOT IN (SELECT id FROM summaries WHERE chat_id = ? ORDER BY created_at DESC LIMIT 10)"
        ).run(String(chatId), String(chatId));
    }

    recentSummaries(chatId, limit = 3) {
        return this.db.prepare(
            "SELECT * FROM summaries WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?"
        ).all(String(chatId), limit);
    }

    // ---- mood ----
    getMood() {
        const row = this.db.prepare("SELECT * FROM moods WHERE key = 'current'").get();
        return row ? { mood: row.mood, setAt: row.set_at, nextRotation: row.next_rotation } : null;
    }
    setMood(mood, nextRotation = null) {
        this.db.prepare(
            "INSERT OR REPLACE INTO moods (key, mood, set_at, next_rotation) VALUES ('current', ?, ?, ?)"
        ).run(mood, Date.now(), nextRotation);
    }

    // ---- initiated message tracking ----
    getSchedule(dateKey) {
        const row = this.db.prepare("SELECT * FROM initiated_schedule WHERE date = ?").get(dateKey);
        if (!row) return null;
        return { times: JSON.parse(row.times), fired: JSON.parse(row.fired || "[]") };
    }
    setSchedule(dateKey, times) {
        this.db.prepare(
            "INSERT OR REPLACE INTO initiated_schedule (date, times, fired, created_at) VALUES (?, ?, '[]', ?)"
        ).run(dateKey, JSON.stringify(times), Date.now());
    }
    markFired(dateKey, timeMs) {
        const sched = this.getSchedule(dateKey);
        if (!sched) return;
        const fired = [...sched.fired, timeMs];
        this.db.prepare("UPDATE initiated_schedule SET fired = ? WHERE date = ?")
            .run(JSON.stringify(fired), dateKey);
    }

    recordSentInitiated(chatId, message) {
        this.db.prepare(
            "INSERT INTO sent_initiated (chat_id, message, sent_at) VALUES (?, ?, ?)"
        ).run(String(chatId), message, Date.now());
        // Purge entries older than 7 days
        this.db.prepare("DELETE FROM sent_initiated WHERE sent_at < ?")
            .run(Date.now() - 7 * 86400000);
    }

    recentSentInitiated(chatId, days = 7) {
        return this.db.prepare(
            "SELECT message FROM sent_initiated WHERE chat_id = ? AND sent_at > ? ORDER BY sent_at DESC"
        ).all(String(chatId), Date.now() - days * 86400000);
    }

    // ---- migration from JSON state ----
    migrateFromJson(state) {
        const migrated = this.getMeta("migrated_from_json");
        if (migrated === "1") return false;

        // Migrate memories
        const jsonMems = state.get("memories", {});
        let memCount = 0;
        for (const [chatId, list] of Object.entries(jsonMems)) {
            for (const m of list) {
                try {
                    if (!this.dedupeMemory(chatId, m.fact)) {
                        this.addMemory(chatId, m.fact, "long", null);
                        memCount++;
                    }
                } catch {}
            }
        }

        // Migrate mood
        const jsonMood = state.get("dailyMood", null);
        if (jsonMood?.mood) {
            this.setMood(jsonMood.mood, null);
        }

        this.setMeta("migrated_from_json", "1");
        console.log(`[TG-store] migrated ${memCount} memories from JSON to SQLite`);
        return true;
    }

    close() {
        this.db.close();
    }
}

module.exports = { Store };
