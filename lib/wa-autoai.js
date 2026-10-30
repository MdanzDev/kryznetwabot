// wa-autoai.js — per-chat WhatsApp switches, shared by the WA bridge (reads)
// and the toggle commands (writes). Persisted so they survive restarts.
//
// Keys are stored together in one JSON object; each setting namespaces its own
// keys so a single file can hold several independent per-chat switches without
// them colliding:
//   autoai   -> "<chatId>"            (AI auto-reply on/off)
//   audio    -> "audio:<chatId>"      (reply with a voice note as well as text)
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const FILE = "/root/kryznetwabot/state/wa_autoai.json";
const DEFAULT_ENABLED = true; // chats with no explicit setting

let cache = null;

function load() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(FILE, "utf8")) || {}; }
    catch { cache = {}; }
    return cache;
}

function isEnabled(chatId) {
    const v = load()[chatId];
    return v === undefined ? DEFAULT_ENABLED : Boolean(v);
}

function setEnabled(chatId, on) {
    const data = load();
    data[chatId] = Boolean(on);
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        const tmp = FILE + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, FILE); // atomic replace
    } catch (e) {
        console.log(`[WA-AutoAI] persist failed: ${e.message}`);
    }
    return data[chatId];
}

// ---- generic per-chat switch ----------------------------------------------
// Every switch persists the same way; only the key prefix and default differ.
// (Three hand-copied setters would drift; one setter cannot.)
function getSwitch(prefix, chatId, dflt) {
    const v = load()[prefix + chatId];
    return v === undefined ? dflt : Boolean(v);
}

function setSwitch(prefix, chatId, on) {
    const key = prefix + chatId;
    const data = load();
    data[key] = Boolean(on);
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        const tmp = FILE + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, FILE); // atomic replace
    } catch (e) {
        console.log(`[WA-AutoAI] persist failed: ${e.message}`);
    }
    return data[key];
}

// ---- audio replies (voice note alongside the text reply) ----
// Off by default: TTS costs a few seconds per message, so it is opt-in per chat.
const DEFAULT_AUDIO = false;
const AUDIO_PREFIX = "audio:";

const isAudioEnabled = (chatId) => getSwitch(AUDIO_PREFIX, chatId, DEFAULT_AUDIO);
const setAudioEnabled = (chatId, on) => setSwitch(AUDIO_PREFIX, chatId, on);

// ---- AI roast mode ----
// When on, Alya fires a short roast at a random member now and then. Costly
// (one AI call per roast) and socially risky, so: off by default, per-chat,
// rate-limited by the bridge, and never in DMs.
const DEFAULT_ROAST = false;
const ROAST_PREFIX = "roast:";

const isRoastEnabled = (chatId) => getSwitch(ROAST_PREFIX, chatId, DEFAULT_ROAST);
const setRoastEnabled = (chatId, on) => setSwitch(ROAST_PREFIX, chatId, on);

// ---- drama (timed) ----
// Drama is its own switch, separate from roast: a chat may want Alya to fire
// back when spoken to but never start something unprompted. Gated on roast too —
// drama is a roast-mode feature, so turning roast off silences both.
const DEFAULT_DRAMA = true;            // on whenever roast is on
const DRAMA_PREFIX = "drama:";

const isDramaEnabled = (chatId) => getSwitch(DRAMA_PREFIX, chatId, DEFAULT_DRAMA);
const setDramaEnabled = (chatId, on) => setSwitch(DRAMA_PREFIX, chatId, on);

// ---- drama interval (per chat) ----
// Stored separately from the switches because it is a number, not a boolean.
// Falls back to DEFAULT_DRAMA_MS when unset or invalid.
const DRAMA_INTERVAL_PREFIX = "drama_ms:";
const DEFAULT_DRAMA_MS = 10 * 60 * 1000;
const MIN_DRAMA_MS = 60 * 1000;        // under a minute is a typo, not a plan

function getDramaInterval(chatId) {
    const v = load()[DRAMA_INTERVAL_PREFIX + chatId];
    const n = Number(v);
    if (!Number.isFinite(n) || n < MIN_DRAMA_MS) return DEFAULT_DRAMA_MS;
    return n;
}

function setDramaInterval(chatId, ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < MIN_DRAMA_MS) return null;
    const key = DRAMA_INTERVAL_PREFIX + chatId;
    const data = load();
    data[key] = n;
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        const tmp = FILE + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, FILE); // atomic replace
    } catch (e) {
        console.log(`[WA-AutoAI] persist failed: ${e.message}`);
    }
    return n;
}

module.exports = {
    isEnabled, setEnabled, DEFAULT_ENABLED,
    isAudioEnabled, setAudioEnabled, DEFAULT_AUDIO,
    isRoastEnabled, setRoastEnabled, DEFAULT_ROAST,
    isDramaEnabled, setDramaEnabled, DEFAULT_DRAMA,
    getDramaInterval, setDramaInterval, DEFAULT_DRAMA_MS, MIN_DRAMA_MS
};