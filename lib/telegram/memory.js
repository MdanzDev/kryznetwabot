// memory.js — long-term and short-term memory for Alya.
// SQLite-backed (node:sqlite). Migrates from JSON state on first run.
// Long-term: durable facts (preferences, names, events).
// Short-term: rolling conversation summaries (auto-extracted).

class LongMemory {
    constructor(state, store = null) {
        this.state = state;     // StateStore (JSON) — still used for backward compat
        this.store = store;     // SQLite Store (optional — falls back to JSON)
        this._initFromJson();
    }

    _initFromJson() {
        if (!this.store) {
            this.memories = this.state.get("memories", {});
            return;
        }
        // SQLite path — memories are in the DB, but we keep a JSON mirror for the
        // old contextBlock() method that the existing index.js expects.
        // Migration is handled by Store.migrateFromJson() in the main constructor.
        this.memories = {};
        // Rebuild the in-memory cache from SQLite
        // (we'll read from SQLite directly in list() and contextBlock())
    }

    list(chatId) {
        if (this.store) {
            const rows = this.store.listMemories(chatId, "long");
            return rows.map(r => ({ fact: r.fact, at: r.created_at }));
        }
        return this.memories[String(chatId)] || [];
    }

    remember(chatId, fact) {
        const key = String(chatId);
        if (this.store) {
            if (this.store.dedupeMemory(key, fact)) return false;
            this.store.addMemory(key, fact, "long", null);
            return true;
        }
        // JSON fallback
        const list = this.memories[key] || (this.memories[key] = []);
        if (list.some((m) => m.fact.toLowerCase() === fact.toLowerCase())) return false;
        list.push({ fact, at: Date.now() });
        while (list.length > 40) list.shift();
        this.state.set("memories", this.memories);
        return true;
    }

    forget(chatId, index) {
        const key = String(chatId);
        if (this.store) {
            // Find the memory at this index and delete by ID
            const list = this.list(chatId);
            if (index < 0 || index >= list.length) return false;
            const target = list[index];
            // We need the DB id — re-query
            const rows = this.store.listMemories(chatId, "long");
            if (rows[index]) {
                this.store.forgetMemory(chatId, rows[index].id);
                return true;
            }
            return false;
        }
        const list = this.memories[key];
        if (!list || index < 0 || index >= list.length) return false;
        list.splice(index, 1);
        this.state.set("memories", this.memories);
        return true;
    }

    clear(chatId) {
        if (this.store) {
            this.store.clearMemories(String(chatId));
            return;
        }
        delete this.memories[String(chatId)];
        this.state.set("memories", this.memories);
    }

    // Short-term: store a conversation summary
    addSummary(chatId, summary) {
        if (this.store) {
            this.store.addSummary(String(chatId), summary);
            return;
        }
        // JSON fallback — keep last 10 summaries
        const key = String(chatId);
        if (!this.state.get("summaries", {})[key]) {
            const s = this.state.get("summaries", {});
            s[key] = [];
            this.state.set("summaries", s);
        }
        const summaries = this.state.get("summaries", {});
        if (!summaries[key]) summaries[key] = [];
        summaries[key].push({ summary, at: Date.now() });
        if (summaries[key].length > 10) summaries[key] = summaries[key].slice(-10);
        this.state.set("summaries", summaries);
    }

    recentSummaries(chatId, limit = 3) {
        if (this.store) {
            const rows = this.store.recentSummaries(String(chatId), limit);
            return rows.map(r => ({ summary: r.summary, at: r.created_at }));
        }
        const summaries = this.state.get("summaries", {});
        return (summaries[String(chatId)] || []).slice(-limit);
    }

    // Formatted block injected into the system prompt
    contextBlock(chatId) {
        const facts = this.list(chatId);
        const summaries = this.recentSummaries(chatId, 2);

        let block = "";
        if (facts.length) {
            const lines = facts.map((m) => `- ${m.fact}`).join("\n");
            block += `\nHAL YANG KAMU INGAT TENTANG USER INI (memori jangka panjang):\n${lines}\n`;
        }
        if (summaries.length) {
            const sumLines = summaries.map(s => `- ${s.summary}`).join("\n");
            block += `\nRINGKASAN PERCAKAPAN SEBELUMNYA (memori jangka pendek):\n${sumLines}\n`;
        }
        return block;
    }
}

module.exports = { LongMemory };
