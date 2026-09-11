// Tiny persistent state for the Telegram bridge — JSON snapshot with
// debounced writes. Survives pm2 restarts. Zero deps.

const fs = require("node:fs");
const path = require("node:path");

class StateStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = {};
        this._timer = null;
        this.load();
    }

    load() {
        try {
            this.data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        } catch {
            this.data = {};
        }
    }

    get(key, fallback = null) {
        return key in this.data ? this.data[key] : fallback;
    }

    set(key, value) {
        this.data[key] = value;
        this.scheduleSave();
    }

    delete(key) {
        delete this.data[key];
        this.scheduleSave();
    }

    scheduleSave() {
        if (this._timer) return;
        this._timer = setTimeout(() => {
            this._timer = null;
            this.save();
        }, 30000); // batch writes: at most once per 30s
        this._timer.unref?.();
    }

    save() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(this.data));
        } catch (e) {
            console.error("[TG-state] save failed:", e.message);
        }
    }
}

module.exports = { StateStore };
