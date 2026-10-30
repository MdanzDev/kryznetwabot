// voice.js — speak Alya's replies.
//
// edge-tts is already installed on this box (used elsewhere via uv) and ffmpeg
// is present for transcoding. WhatsApp voice notes need OGG/Opus, which is what
// the `ptt: true` audio shape expects; sending mp3 as ptt produces a "cannot
// play" bubble, the same class of failure as the 36KB HTML audio.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const EDGE_TTS = "/root/.local/bin/edge-tts";
const VOICE = "ms-MY-YasminNeural";   // Malay female — matches Alya's register
const TIMEOUT_MS = 60_000;

const run = (cmd, args, timeout = TIMEOUT_MS) =>
    new Promise((resolve) => {
        execFile(cmd, args, { timeout, maxBuffer: 1e6 }, (e, _so, se) =>
            resolve({ e, err: se || "" }));
    });

/**
 * Render text to a WhatsApp-ready Opus voice note.
 * @returns {Promise<{buffer: Buffer, mimetype: string}|null>} null on failure
 */
async function synthesize(text, { voice = VOICE } = {}) {
    const clean = String(text || "")
        // strip kaomoji/emoji noise that TTS reads aloud as garbage
        .replace(/[\(（][^)）]{0,30}[)）]/g, " ")
        .replace(/[*_~`#>|]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 600);
    if (!clean) return null;

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const mp3 = path.join("/tmp", `tts_${id}.mp3`);
    const ogg = path.join("/tmp", `tts_${id}.ogg`);

    try {
        const said = await run(EDGE_TTS, ["--voice", voice, "--text", clean, "--write-media", mp3]);
        if (said.e || !fs.existsSync(mp3) || fs.statSync(mp3).size < 1024) return null;

        // Opus-in-OGG mono 48k — the only encoding WhatsApp plays as a voice note.
        const conv = await run("ffmpeg", [
            "-y", "-i", mp3,
            "-c:a", "libopus", "-b:a", "48k", "-ar", "48000", "-ac", "1",
            "-application", "voip", ogg
        ]);
        if (conv.e || !fs.existsSync(ogg) || fs.statSync(ogg).size < 1024) return null;

        return { buffer: fs.readFileSync(ogg), mimetype: "audio/ogg; codecs=opus" };
    } finally {
        for (const f of [mp3, ogg]) { try { fs.unlinkSync(f); } catch (_) {} }
    }
}

module.exports = { synthesize, VOICE };
