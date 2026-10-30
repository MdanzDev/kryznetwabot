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

module.exports = {
    isEnabled, setEnabled, DEFAULT_ENABLED,
    isAudioEnabled, setAudioEnabled, DEFAULT_AUDIO,
    isRoastEnabled, setRoastEnabled, DEFAULT_ROAST
};