// Long-term memory for Alya — persistent facts per chat.
// The AI can store/recall facts across sessions: preferences, names, events.
// Stored in the telegram.json state file under "memories".

class LongMemory {
    constructor(state) {
        this.state = state;
        this.memories = state.get("memories", {}); // chatId -> [{ fact, at }]
    }

    _save() {
        this.state.set("memories", this.memories);
    }

    list(chatId) {
        return this.memories[String(chatId)] || [];
    }

    remember(chatId, fact) {
        const key = String(chatId);
        const list = this.memories[key] || (this.memories[key] = []);
        // dedupe near-identical facts
        if (list.some((m) => m.fact.toLowerCase() === fact.toLowerCase())) return false;
        list.push({ fact, at: Date.now() });
        // cap per chat — drop oldest
        while (list.length > 40) list.shift();
        this._save();
        return true;
    }

    forget(chatId, index) {
        const list = this.memories[String(chatId)];
        if (!list || index < 0 || index >= list.length) return false;
        list.splice(index, 1);
        this._save();
        return true;
    }

    clear(chatId) {
        delete this.memories[String(chatId)];
        this._save();
    }

    // Formatted block injected into the system prompt
    contextBlock(chatId) {
        const list = this.list(chatId);
        if (!list.length) return "";
        const lines = list.map((m) => `- ${m.fact}`).join("\n");
        return `\nHAL YANG KAMU INGAT TENTANG USER INI (memori jangka panjang):\n${lines}\n`;
    }
}

module.exports = { LongMemory };
