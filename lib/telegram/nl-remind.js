// nl-remind.js — "ingatkan aku 2 jam lagi ..." without the command prefix.
//
// A companion bot that requires ".remind 2h x" is a CLI with a chat skin. This
// recognises the common natural phrasings in Malay/English and turns them into
// the same Scheduler job the .remind command creates, so there is exactly one
// place that owns reminder state.
//
// Deliberately conservative: it must NOT misfire on ordinary chat ("aku ingat
// kau semalam"). Only an explicit reminder verb + a time expression matches, and
// it returns null otherwise so the message flows to the AI untouched.
"use strict";

// (ingat|ingatkan|remind|reminder) [aku|saya|i|me] <time> <text>
const RE = /^\s*(?:tolong\s+)?(?:ingatkan|ingat|remind(?:\s+me)?|reminder)\b\s*(?:aku|saya|i|me|kan|aku\s+ya)?\s*(.+)$/i;

// time units -> ms
const UNITS = [
    { re: /^(\d+)\s*(?:minit|min|m)\b/i, ms: 60_000 },
    { re: /^(\d+)\s*(?:jam|j|h|hour|hours|hr)\b/i, ms: 3_600_000 },
    { re: /^(\d+)\s*(?:hari|d|day|days)\b/i, ms: 86_400_000 },
    { re: /^(\d+)\s*(?:minggu|week|weeks|w)\b/i, ms: 604_800_000 }
];

// "pukul 3 petang", "jam 9 malam", "at 3pm", "09:00"
function parseClock(s) {
    let m = s.match(/^(?:pukul|jam|at)?\s*(\d{1,2})[:.](\d{2})\s*(am|pm|pagi|tengahari|petang|malam)?\b/i);
    if (m) {
        let h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const ap = (m[3] || "").toLowerCase();
        if (ap === "pm" || ap === "petang" || ap === "malam") { if (h < 12) h += 12; }
        if (ap === "am" || ap === "pagi") { if (h === 12) h = 0; }
        if (ap === "tengahari") { if (h < 12) h += 12; }
        if (h > 23 || min > 59) return null;
        return { hour: h, minute: min };
    }
    m = s.match(/^(?:pukul|jam|at)?\s*(\d{1,2})\s*(am|pm|pagi|tengahari|petang|malam)\b/i);
    if (m) {
        let h = parseInt(m[1], 10);
        const ap = m[2].toLowerCase();
        if (ap === "pm" || ap === "petang" || ap === "malam") { if (h < 12) h += 12; }
        if (ap === "am" || ap === "pagi") { if (h === 12) h = 0; }
        if (ap === "tengahari") { if (h < 12) h += 12; }
        if (h > 23) return null;
        return { hour: h, minute: 0 };
    }
    return null;
}

/**
 * @returns {{kind:'relative', ms:number, text:string}
 *          |{kind:'daily', hour:number, minute:number, text:string}
 *          |null}
 */
function parseReminder(body) {
    const raw = String(body || "").trim();
    if (!raw || raw.length > 300) return null;
    const m = raw.match(RE);
    if (!m) return null;

    let rest = m[1].trim();
    if (!rest) return null;

    // "dalam 2 jam <text>"
    rest = rest.replace(/^dalam\s+/i, "");

    // relative?
    for (const u of UNITS) {
        const hit = rest.match(u.re);
        if (hit) {
            const n = parseInt(hit[1], 10);
            const text = rest.slice(hit[0].length).replace(/^[,:\-\s]+/, "").trim();
            if (!text) return null;
            if (!Number.isFinite(n) || n <= 0 || n > 366 * 24 * 60) return null;
            return { kind: "relative", ms: n * u.ms, text };
        }
    }

    // daily clock?
    const clock = parseClock(rest);
    if (clock) {
        const after = rest.replace(/^(?:pukul|jam|at)?\s*\d{1,2}[:.]?\d{0,2}\s*(?:am|pm|pagi|tengahari|petang|malam)?\b/i, "").trim();
        const text = after.replace(/^[,:\-\s]+/, "").trim();
        if (!text) return null;
        return { kind: "daily", hour: clock.hour, minute: clock.minute, text };
    }

    return null;
}

module.exports = { parseReminder };
