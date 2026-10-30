// game-session.js — one place that owns "is this game still running?" and
// "why did it end?".
//
// Every game had its own module-level `sessions` Map and its own guess at how
// to check it. Three of them checked the wrong key (`ctx.id` instead of the
// composed key), so the timeout branch never ran and the game went silent AND
// left the chat permanently blocked.
//
// The collector emits ("end", reason) for EVERY stop: "timeout", "limit",
// "processedLimit", "" (explicit stop). Only a timeout should be announced —
// announcing on a correct answer would be a lie. This helper makes that
// distinction explicit instead of relying on a session-has check that races
// with the delete that already happened.
"use strict";

class GameSessions {
    constructor() {
        this.active = new Map();   // key -> { startedAt, timeoutMs }
    }

    /** Claim the slot. Returns false when a game is already running. */
    start(key, { timeoutMs = 0 } = {}) {
        if (this.active.has(key)) return false;
        this.active.set(key, { startedAt: Date.now(), timeoutMs });
        return true;
    }

    isActive(key) {
        return this.active.has(key);
    }

    /** Release the slot. Safe to call twice. */
    end(key) {
        return this.active.delete(key);
    }

    /**
     * Run the collector's end handler with the correct semantics:
     * the caller supplies what to say on a real timeout, and this decides
     * whether it applies. Silences non-timeout ends.
     */
    async onEnd(key, reason, sayTimeout) {
        const wasActive = this.active.has(key);
        this.end(key);
        // "timeout" is the only reason that deserves a message. Any other reason
        // means the game concluded normally (answer, surrender, limit).
        if (reason === "timeout" && wasActive && typeof sayTimeout === "function") {
            await sayTimeout();
        }
    }

    /** Test/debug helper. */
    snapshot() {
        return [...this.active.keys()];
    }
}

// A shared instance per game module is what the games already effectively had
// (module-level Map); exporting a factory keeps tests isolated.
const createGameSessions = () => new GameSessions();

module.exports = { GameSessions, createGameSessions };
