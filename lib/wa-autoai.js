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

// ---- audio replies (voice note alongside the text reply) ----
// Off by default: TTS costs a few seconds per message, so it is opt-in per chat.
const DEFAULT_AUDIO = false;
const AUDIO_PREFIX = "audio:";

function isAudioEnabled(chatId) {
    const v = load()[AUDIO_PREFIX + chatId];
    return v === undefined ? DEFAULT_AUDIO : Boolean(v);
}

function setAudioEnabled(chatId, on) {
    const key = AUDIO_PREFIX + chatId;
    const data = load();
    data[key] = Boolean(on);
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        const tmp = FILE + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, FILE);
    } catch (e) {
        console.log(`[WA-AutoAI] persist failed: ${e.message}`);
    }
    return data[key];
}

module.exports = { isEnabled, setEnabled, DEFAULT_ENABLED, isAudioEnabled, setAudioEnabled, DEFAULT_AUDIO };