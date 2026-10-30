// watchdog.js — tell the owner when a service actually dies.
//
// Rationale: this server has a recurring failure mode where something stops
// silently (the API webhook was dead for weeks, pm2 'api' sat stopped, the
// anti-spam handler threw into a swallowed promise). Nothing reported it. This
// closes that hole with the smallest thing that works: a periodic probe of the
// things that must be alive, and a WhatsApp message only on a state CHANGE.
//
// Deliberately stateful: an outage pings once, and recovery pings once. Alert
// spam gets muted by the owner, which is worse than no alerts at all.
"use strict";
const { execFile } = require("node:child_process");

const DEFAULT_INTERVAL_MS = 5 * 60_000;

// Each target: must be reachable/healthy for `check` to resolve true.
// pm2 apps are checked by name, ports by TCP connect.
const TARGETS = [
    { id: "bot", kind: "pm2", name: "AlyaMD" },
    { id: "api", kind: "pm2", name: "api" },
    { id: "payment", kind: "pm2", name: "kryz-payment-terminal" },
    { id: "nginx", kind: "proc", pattern: "nginx: master" },
    { id: "wa", kind: "wa" }
];

const run = (cmd, args, timeout = 15_000) =>
    new Promise((resolve) => {
        execFile(cmd, args, { timeout, maxBuffer: 1e6 }, (e, so) => resolve({ e, out: so || "" }));
    });

class Watchdog {
    /**
     * @param {object} deps
     * @param {(text:string)=>Promise<void>} deps.notify  owner-facing transport
     * @param {()=>boolean} deps.waReady                 is the WA socket connected
     */
    constructor({ notify, waReady, intervalMs = DEFAULT_INTERVAL_MS, targets = TARGETS } = {}) {
        if (typeof notify !== "function") throw new TypeError("Watchdog needs a notify()");
        this.notify = notify;
        this.waReady = waReady || (() => true);
        this.intervalMs = intervalMs;
        this.targets = targets;
        this.state = new Map();   // id -> "up" | "down"
        this.timer = null;
        this.checking = false;
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => this.tick().catch(() => {}), this.intervalMs);
        this.timer.unref?.();
        console.log(`[watchdog] started, ${this.targets.length} target(s), every ${Math.round(this.intervalMs / 1000)}s`);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    async _pm2Up(name) {
        const { e, out } = await run("pm2", ["jlist"]);
        if (e) return null; // pm2 itself unreachable -> unknown, do not alert
        try {
            const list = JSON.parse(out);
            const app = list.find((p) => p.name === name);
            if (!app) return null;
            return app.pm2_env?.status === "online";
        } catch {
            return null;
        }
    }

    async _procUp(pattern) {
        // pgrep -f matches the full command line; -c counts.
        const { e, out } = await run("pgrep", ["-c", "-f", pattern]);
        if (e) return false;
        return parseInt(out.trim(), 10) > 0;
    }

    async check(target) {
        if (target.kind === "pm2") return this._pm2Up(target.name);
        if (target.kind === "proc") return this._procUp(target.pattern);
        if (target.kind === "wa") return Boolean(this.waReady());
        return null;
    }

    async tick() {
        if (this.checking) return; // never overlap slow probes
        this.checking = true;
        try {
            for (const t of this.targets) {
                let up;
                try {
                    up = await this.check(t);
                } catch {
                    up = null;
                }
                if (up === null || up === undefined) continue; // unknown: keep previous state
                const prev = this.state.get(t.id);
                const next = up ? "up" : "down";
                this.state.set(t.id, next);

                // Only report transitions. First observation of "down" counts.
                if (next === "down" && prev !== "down") {
                    await this._alert(`⚠️ *Perkhidmatan mati*\n\n♡ ${t.id}${t.name ? ` (${t.name})` : ""}\n♡ ${new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })} (MYT)\n\nCuba: \`pm2 list\``);
                } else if (next === "up" && prev === "down") {
                    await this._alert(`✅ *Pulih semula*\n\n♡ ${t.id}${t.name ? ` (${t.name})` : ""} dah hidup balik.`);
                }
            }
        } finally {
            this.checking = false;
        }
    }

    async _alert(text) {
        try {
            await this.notify(text);
        } catch (e) {
            console.error("[watchdog] notify failed:", e.message);
        }
    }

    // For tests / manual runs.
    snapshot() {
        return Object.fromEntries(this.state);
    }
}

module.exports = { Watchdog, TARGETS };
