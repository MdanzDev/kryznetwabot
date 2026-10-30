const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

// ╭───────────────୨୧
// │ SETTINGS
// ╰───────────────୨୧

const RESOLUTIONS = ["360", "480", "720", "1080"];
const DEFAULT_RES = "480";
const VIDEO_MAX_MB = 60;
const BUTTON_TIMEOUT_MS = 60_000;
const YTDLP_TIMEOUT_MS = 300_000;
const MAX_ALBUM_PARTS = 10;

const YTDLP_COOKIES = "/root/kryznetwabot/cookies.txt";
const BGUTIL_URL    = "http://127.0.0.1:27103";
const YTDLP_CLIENTS = "default";
const DENO_BIN_DIR  = path.join(process.env.HOME || "/root", ".deno/bin");
const YTDLP_CACHE   = "/tmp/yt-dlp-cache";

// ── owner notifications ──
const OWNER_JID = "60137345871@s.whatsapp.net";
const NOTIFY_COOLDOWN_MS = 10 * 60_000;
const _notifyState = new Map();

const RES_META = {
    "360":  { emoji: "🪶", tag: "Cepat",   hint: "Hemat data · proses paling laju" },
    "480":  { emoji: "⚖️", tag: "Balance", hint: "Seimbang · recommended" },
    "720":  { emoji: "🎬", tag: "HD",      hint: "Jelas · saiz sederhana" },
    "1080": { emoji: "💎", tag: "FullHD",  hint: "Paling jelas · saiz paling besar" }
};

const STYLE = {
    enableForward: true,
    forwardScore: 5,
    enableChannel: true,
    channelInvite: "0029Vb8RP9f3bbV0ST0ZrL0X",
    channelName: "Kryz | Cloud & Hosting",
    channelServerId: 1
};

// ╭───────────────୨୧
// │ STYLE HELPERS
// ╰───────────────୨୧

let _newsletterJid = null;
let _warmed = false;

const warmStyle = async (sock) => {
    if (_warmed) return;
    _warmed = true;
    if (!STYLE.enableChannel) return;
    try {
        const meta = await sock.newsletterMetadata("invite", STYLE.channelInvite);
        _newsletterJid = meta?.id || null;
    } catch (_) {}
};

const buildContextInfo = () => {
    const contextInfo = {};
    if (STYLE.enableForward) {
        contextInfo.forwardingScore = STYLE.forwardScore;
        contextInfo.isForwarded = true;
    }
    if (STYLE.enableChannel && _newsletterJid) {
        contextInfo.forwardedNewsletterMessageInfo = {
            newsletterJid: _newsletterJid,
            newsletterName: STYLE.channelName,
            serverMessageId: STYLE.channelServerId
        };
    }
    return contextInfo;
};

// ╭───────────────୨୧
// │ OWNER NOTIFICATIONS
// ╰───────────────୨୧

const notifyOwner = async (ctx, topic, text) => {
    const now = Date.now();
    const last = _notifyState.get(topic) || 0;
    if (now - last < NOTIFY_COOLDOWN_MS) return false;
    _notifyState.set(topic, now);

    try {
        await ctx._self.sendMessage(
            OWNER_JID,
            {
                text:
                    "🔔 *bot alert*\n" +
                    "━━━━━━━━━━━━━━━━\n" +
                    text + "\n\n" +
                    `⏱ ${new Date().toISOString().replace("T", " ").slice(0, 19)}`,
                contextInfo: buildContextInfo()
            }
        );
        return true;
    } catch (e) {
        console.warn(`[notify] failed to reach owner: ${e.message}`);
        return false;
    }
};

// ╭───────────────୨୧
// │ FORMAT HELPERS
// ╰───────────────୨୧

const truncate = (s, n) => {
    s = String(s ?? "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

const fmtDuration = (d) => {
    if (d === null || d === undefined || d === "") return null;
    if (typeof d === "string") return d.trim() || null;
    if (typeof d !== "number" || isNaN(d)) return null;
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor(d % 60);
    return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${m}:${String(s).padStart(2, "0")}`;
};

const fmtViews = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "string") return v.trim() || null;
    if (typeof v !== "number" || isNaN(v)) return null;
    if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return String(v);
};

const fmtDate = (d) => {
    if (d === null || d === undefined || d === "") return null;
    if (typeof d === "string") {
        if (/^\d{8}$/.test(d)) {
            return `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}`;
        }
        return d;
    }
    return null;
};

// ╭───────────────୨୧
// │ PROCESS HELPERS
// ╰───────────────୨୧

const run = (cmd, args, timeout = 600_000, env = null) =>
    new Promise((resolve) =>
        execFile(
            cmd,
            args,
            { timeout, maxBuffer: 1e7, env: env || process.env },
            (e, so, se) => resolve({ e, so: so || "", se: se || "" })
        )
    );

// An MP4/M4A carries an ISO-BMFF "ftyp" box at offset 4. Guards against a dead
// CDN answering 200 with an HTML landing page, which the size check lets past.
const isMp4File = (file) => {
    try {
        const fd = fs.openSync(file, "r");
        const head = Buffer.alloc(8);
        const n = fs.readSync(fd, head, 0, 8, 0);
        fs.closeSync(fd);
        if (n < 8) return false;
        return head.toString("latin1", 4, 8) === "ftyp";
    } catch (_) {
        return false;
    }
};

const ytdlpEnv = () => ({
    ...process.env,
    BGU_HTTP_BASE_URL: BGUTIL_URL,
    PATH: `${DENO_BIN_DIR}:${process.env.PATH || ""}`
});

try { fs.mkdirSync(YTDLP_CACHE, { recursive: true }); } catch (_) {}

(() => {
    if (!fs.existsSync(YTDLP_COOKIES)) {
        console.warn(`[playvid] cookies.txt missing at ${YTDLP_COOKIES}.`);
    } else {
        try {
            const head = fs.readFileSync(YTDLP_COOKIES, "utf8").split(/\r?\n/, 1)[0];
            if (!/Netscape HTTP Cookie File|HTTP Cookie File/i.test(head)) {
                console.warn(`[playvid] cookies.txt not Netscape format`);
            } else {
                console.log(`[playvid] cookies.txt OK`);
            }
        } catch (_) {}
    }
})();

// ╭───────────────୨୧
// │ ERROR MAPPING
// ╰───────────────୨୧

const friendlyYtdlpError = (stderr, code) => {
    const s = String(stderr || "");
    if (/Sign in to confirm|not a bot/i.test(s))
        return "YouTube minta pengesahan (bot-check / cookies luput).";
    if (/PO Token|po_token/i.test(s))
        return "PO Token gagal. Semak bgutil-pot di " + BGUTIL_URL + ".";
    if (/n challenge solving failed/i.test(s))
        return "Deno tidak dijumpai. Semak `deno --version`.";
    if (/Video unavailable|Private video|removed|age-restricted/i.test(s))
        return "Video tidak tersedia / private / age-restricted.";
    if (/HTTP Error 429|Too Many Requests/i.test(s))
        return "YouTube rate-limit (429).";
    if (/Requested format is not available/i.test(s))
        return "Format tidak tersedia pada resolusi ini.";
    if (/ENOENT/i.test(s))
        return "yt-dlp / ffmpeg tidak dijumpai.";
    if (code) return `yt-dlp exit ${code}: ${s.slice(-200)}`;
    return "yt-dlp gagal: " + s.slice(-200);
};

// ╭───────────────୨୧
// │ PRIMARY: yt-dlp
// ╰───────────────୨୧

const ytdlpDownload = async (url, res) => {
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const outTemplate = `/tmp/pvdl_${id}.%(ext)s`;

    const fmt =
        `bv*[height<=${res}][vcodec^=avc1]+ba[ext=m4a]/` +
        `bv*[height<=${res}][vcodec^=avc1]+ba/` +
        `b[height<=${res}]/` +
        `bv*[height<=${res}]+ba/` +
        `bv*[height<=${res}]`;

    const baseArgs = [
        "--no-warnings", "--no-playlist", "--no-progress",
        "--retries", "3", "--socket-timeout", "30",
        "--concurrent-fragments", "4",
        "--no-part",
        "--cache-dir", YTDLP_CACHE,
        "--extractor-args", `youtube:player_client=${YTDLP_CLIENTS};fetch_pot=always`,
        "-f", fmt,
        "--merge-output-format", "mp4",
        "-o", outTemplate,
        url
    ];

    const env = ytdlpEnv();

    let dl = await run(
        "yt-dlp",
        ["--cookies", YTDLP_COOKIES, ...baseArgs],
        YTDLP_TIMEOUT_MS,
        env
    );

    if (dl.e && /Sign in to confirm|not a bot|cookies/i.test(dl.se || "")) {
        console.log(`[playvid] cookies rejected — retrying without cookies`);
        dl = await run("yt-dlp", baseArgs, YTDLP_TIMEOUT_MS, env);
    }

    const files = fs.readdirSync("/tmp").filter((f) => f.startsWith(`pvdl_${id}.`));
    const cleanup = () => {
        for (const f of files) {
            try { fs.unlinkSync(path.join("/tmp", f)); } catch (_) {}
        }
    };

    if (!files.length) {
        cleanup();
        throw new Error(friendlyYtdlpError(dl.se, dl.e?.code));
    }

    let outFile = path.join("/tmp", files[0]);
    let biggest = 0;
    for (const f of files) {
        const full = path.join("/tmp", f);
        const sz = fs.statSync(full).size;
        if (sz > biggest) { biggest = sz; outFile = full; }
    }

    return { file: outFile, cleanup, source: "yt-dlp" };
};

// ╭───────────────୨୧
// │ FALLBACK: nexray API
// ╰───────────────୨୧

const apiDownload = async (ctx, url, res) => {
    const apiUrl = ctx.api.createUrl("nexray", "/downloader/savetube", {
        url,
        quality: res
    });
    const resp = await ctx.request.get(apiUrl);
    const direct = resp?.data?.result?.url;
    if (!direct) throw new Error("API tidak memulangkan URL.");

    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const outFile = `/tmp/pvapi_${id}.mp4`;

    const dl = await run("curl", [
        "-L", "-s", "--max-time", "180",
        "-o", outFile, direct
    ], 200_000);

    const cleanup = () => {
        try { fs.unlinkSync(outFile); } catch (_) {}
    };

    if (dl.e || !fs.existsSync(outFile) || fs.statSync(outFile).size < 1024) {
        cleanup();
        throw new Error("Muat turun API gagal.");
    }

    if (!isMp4File(outFile)) {
        cleanup();
        throw new Error("API memulangkan fail bukan video (HTML).");
    }

    return { file: outFile, cleanup, source: "nexray" };
};

// ╭───────────────୨୧
// │ UNIFIED FETCHER (yt-dlp → API)
// ╰───────────────୨୧

const fetchVideo = async (ctx, url, res) => {
    try {
        return await ytdlpDownload(url, res);
    } catch (ytErr) {
        console.warn(`[playvid] yt-dlp failed: ${ytErr.message}`);
        await notifyOwner(
            ctx,
            "ytdlp-video-fail",
            `*yt-dlp gagal — fallback ke API*\n` +
            `♡ URL    › ${truncate(url, 60)}\n` +
            `♡ Res    › ${res}p\n` +
            `♡ Sebab  › ${truncate(ytErr.message, 200)}\n\n` +
            `Semak cookies / bgutil bila sempat.`
        ).catch(() => {});
    }

    try {
        return await apiDownload(ctx, url, res);
    } catch (apiErr) {
        await notifyOwner(
            ctx,
            "both-video-fail",
            `⚠️ *Kedua-dua sumber gagal (video)*\n` +
            `♡ URL    › ${truncate(url, 60)}\n` +
            `♡ Res    › ${res}p\n` +
            `♡ API    › ${truncate(apiErr.message, 200)}\n\n` +
            `User tak dapat video ini. Semak segera.`
        ).catch(() => {});

        throw new Error(
            "Kedua-dua sumber gagal.\n\n" +
            "♡ yt-dlp  › cuba lagi atau semak cookies/bgutil\n" +
            "♡ API     › " + apiErr.message
        );
    }
};

// ╭───────────────୨୧
// │ TRANSCODE / REMUX
// ╰───────────────୨୧

const ensureWhatsApp = async (inputFile) => {
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const outFile = `/tmp/pvwa_${id}.mp4`;
    const cleanup = () => {
        try { fs.unlinkSync(outFile); } catch (_) {}
    };

    try {
        const probe = await run("ffprobe", [
            "-v", "error",
            "-show_entries", "stream=codec_type,codec_name,pix_fmt",
            "-of", "json", inputFile
        ], 60_000);

        let streams = [];
        try { streams = JSON.parse(probe.so).streams || []; } catch (_) {}

        const v = streams.find((s) => s.codec_type === "video");
        const hasAudio = streams.some((s) => s.codec_type === "audio");
        if (!v) throw new Error("Fail tiada aliran video.");

        const copyVideo = v.codec_name === "h264" && v.pix_fmt === "yuv420p";

        const args = ["-threads", "0", "-y", "-i", inputFile];
        if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
        args.push("-map", "0:v:0", "-map", hasAudio ? "0:a:0" : "1:a:0");
        args.push(
            "-c:v",
            ...(copyVideo
                ? ["copy"]
                : ["libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p"])
        );
        args.push(
            "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
            "-shortest", "-movflags", "+faststart", outFile
        );

        const conv = await run("ffmpeg", args);
        if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 1024)
            throw new Error("ffmpeg gagal:\n" + (conv.se || "").slice(-300));

        const buffer = fs.readFileSync(outFile);
        cleanup();
        return { buffer, size: buffer.length, silent: !hasAudio };
    } catch (err) {
        cleanup();
        throw err;
    }
};

// ╭───────────────୨୧
// │ SPLITTER
// ╰───────────────୨୧

const splitVideo = async (inputFile, maxBytes) => {
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const outTemplate = `/tmp/pvseg_${id}_%03d.mp4`;

    const probe = await run("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        inputFile
    ], 30_000);
    const duration = parseFloat(String(probe.so).trim()) || 0;
    if (!duration) throw new Error("Gagal mengukur durasi untuk split.");

    const totalSize = fs.statSync(inputFile).size;
    let parts = Math.max(2, Math.ceil((totalSize / maxBytes) * 1.05));
    if (parts > MAX_ALBUM_PARTS) parts = MAX_ALBUM_PARTS;

    let files = [];
    const clearFiles = () => {
        for (const f of files) { try { fs.unlinkSync(f); } catch (_) {} }
        files = [];
    };

    try {
        for (let attempt = 0; attempt < 4; attempt++) {
            clearFiles();
            const segTime = duration / parts;
            const args = [
                "-threads", "0", "-y",
                "-i", inputFile,
                "-map", "0:v", "-map", "0:a?",
                "-c", "copy",
                "-f", "segment",
                "-segment_time", segTime.toFixed(3),
                "-reset_timestamps", "1",
                "-avoid_negative_ts", "make_zero",
                "-segment_format", "mp4",
                "-movflags", "+faststart",
                outTemplate
            ];

            const seg = await run("ffmpeg", args);
            files = fs
                .readdirSync("/tmp")
                .filter((f) => f.startsWith(`pvseg_${id}_`))
                .map((f) => path.join("/tmp", f))
                .sort();

            if (!files.length)
                throw new Error("ffmpeg gagal split:\n" + (seg.se || "").slice(-300));

            const biggest = Math.max(...files.map((f) => fs.statSync(f).size));
            if (biggest <= maxBytes) break;

            parts = Math.min(parts + 1, MAX_ALBUM_PARTS);
            if (parts >= MAX_ALBUM_PARTS && attempt >= 2) break;
        }

        const biggest = Math.max(...files.map((f) => fs.statSync(f).size));
        if (biggest > maxBytes) {
            clearFiles();
            throw new Error(
                `Video terlalu besar untuk di-split (${(totalSize / 1048576).toFixed(0)} MB). ` +
                `Sila pilih hantar sebagai dokumen.`
            );
        }

        const buffers = files.map((f) => fs.readFileSync(f));
        clearFiles();
        return { buffers, count: buffers.length };
    } catch (err) {
        clearFiles();
        throw err;
    }
};

// ╭───────────────୨୧
// │ VIDEO INFO BLOCK
// ╰───────────────୨୧

const buildVideoInfoBlock = (info) => {
    const lines = ["╭┈┈┈┈┈┈┈┈୨୧", "┊ ✦ 𝑰𝒏𝒇𝒐 𝑽𝒊𝒅𝒆𝒐 ୨୧"];
    const push = (label, value) => {
        if (value === null || value === undefined || value === "" || value === "-") return;
        lines.push(`┊ ♡ ${label.padEnd(8)} › ${value}`);
    };
    push("Judul",   truncate(info.title, 45));
    push("Channel", truncate(info.channel, 35));
    push("Durasi",  info.duration);
    push("Views",   info.views);
    push("Upload",  info.uploaded);
    lines.push("╰┈┈┈┈┈┈┈┈୨୧");
    return lines.join("\n");
};

// ╭───────────────୨୧
// │ QUALITY PICKER
// ╰───────────────୨୧

const askQuality = async (ctx, info) => {
    const token =
        "q_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const buttons = RESOLUTIONS.map((r) => {
        const m = RES_META[r] || { emoji: "🎞️", tag: "" };
        const star = r === DEFAULT_RES ? "⭐ " : "";
        return {
            buttonId: `${token}:${r}`,
            buttonText: { displayText: `${star}${m.emoji} ${r}p ${m.tag}`.trim() },
            type: 1
        };
    });

    const detailLines = RESOLUTIONS.map((r) => {
        const m = RES_META[r] || { emoji: "🎞️", hint: "" };
        const star = r === DEFAULT_RES ? " ⭐" : "";
        return `┊ ${m.emoji} ${r}p${star}\n┊    › ${m.hint}`;
    }).join("\n┊\n");

    const caption =
        "╭───────────────୨୧\n" +
        "│  ₊˚⊹♡  𝑷𝒊𝒍𝒊𝒉 𝑲𝒖𝒂𝒍𝒊𝒕𝒊  ♡⊹˚₊\n" +
        "│ (｡･ω･｡)ﾉ Pilih resolusi video~ ✧\n" +
        "╰───────────────୨୧\n\n" +
        (info ? buildVideoInfoBlock(info) + "\n\n" : "") +
        "╭┈┈┈┈┈┈┈┈୨୧\n" +
        "┊ ✦ 𝑷𝒊𝒍𝒊𝒉𝒂𝒏 ୨୧\n" +
        detailLines + "\n" +
        "╰┈┈┈┈┈┈┈┈୨୧\n\n" +
        `⏳ Timeout: ${BUTTON_TIMEOUT_MS / 1000} detik`;

    const base = {
        footer: config.msg.footer,
        buttons,
        headerType: 1,
        contextInfo: buildContextInfo()
    };

    let sent = false;
    if (info?.thumbnail) {
        try {
            await ctx.reply({ ...base, image: { url: info.thumbnail }, caption });
            sent = true;
        } catch (_) {}
    }
    if (!sent) await ctx.reply({ ...base, text: caption });

    return await new Promise((resolve) => {
        const sock = ctx._client;
        const cleanup = () => {
            clearTimeout(timer);
            try { sock.ev.off("messages.upsert", handler); } catch (_) {}
        };
        const timer = setTimeout(() => { cleanup(); resolve(null); }, BUTTON_TIMEOUT_MS);
        const handler = (ev) => {
            try {
                const msg = ev?.messages?.[0];
                if (!msg?.message) return;
                if (msg.key?.remoteJid !== ctx.id) return;
                const interactive =
                    msg.message.buttonsResponseMessage ||
                    msg.message.templateButtonReplyMessage ||
                    msg.message.listResponseMessage;
                if (!interactive) return;
                const selected =
                    interactive.selectedButtonId ||
                    interactive.selectedId ||
                    interactive.singleSelectReply?.selectedRowId;
                if (!selected || !selected.startsWith(token + ":")) return;
                const res = selected.slice(token.length + 1);
                if (!RESOLUTIONS.includes(res)) return;
                cleanup();
                resolve(res);
            } catch (_) {}
        };
        sock.ev.on("messages.upsert", handler);
    });
};

// ╭───────────────୨୧
// │ OVERSIZE PICKER
// ╰───────────────୨୧

const askOversizeAction = async (ctx, mb, estParts) => {
    const token =
        "o_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const buttons = [
        {
            buttonId: `${token}:album`,
            buttonText: { displayText: `🎞️ Split Album (${estParts})` },
            type: 1
        },
        {
            buttonId: `${token}:doc`,
            buttonText: { displayText: "📎 Dokumen" },
            type: 1
        }
    ];

    await ctx.reply({
        text:
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑭𝒂𝒊𝒍 𝑩𝒆𝒔𝒂𝒓  ♡⊹˚₊\n" +
            "│ (｡･ω･｡)ﾉ Video ni melebihi had WhatsApp\n" +
            "╰───────────────୨୧\n\n" +
            `♡ Saiz    › ${mb.toFixed(1)} MB\n` +
            `♡ Had     › ${VIDEO_MAX_MB} MB\n` +
            `♡ Cadangan› ${estParts} part (album)\n\n` +
            "Mahu hantar macam mana?",
        footer: config.msg.footer,
        buttons,
        headerType: 1,
        contextInfo: buildContextInfo()
    });

    return await new Promise((resolve) => {
        const sock = ctx._client;
        const cleanup = () => {
            clearTimeout(timer);
            try { sock.ev.off("messages.upsert", handler); } catch (_) {}
        };
        const timer = setTimeout(() => { cleanup(); resolve(null); }, BUTTON_TIMEOUT_MS);
        const handler = (ev) => {
            try {
                const msg = ev?.messages?.[0];
                if (!msg?.message) return;
                if (msg.key?.remoteJid !== ctx.id) return;
                const interactive =
                    msg.message.buttonsResponseMessage ||
                    msg.message.templateButtonReplyMessage ||
                    msg.message.listResponseMessage;
                if (!interactive) return;
                const selected =
                    interactive.selectedButtonId ||
                    interactive.selectedId ||
                    interactive.singleSelectReply?.selectedRowId;
                if (!selected || !selected.startsWith(token + ":")) return;
                const choice = selected.slice(token.length + 1);
                if (!["album", "doc"].includes(choice)) return;
                cleanup();
                resolve(choice);
            } catch (_) {}
        };
        sock.ev.on("messages.upsert", handler);
    });
};

// ╭───────────────୨୧
// │ COMMAND
// ╰───────────────୨୧

module.exports = {
    name: "playvid",
    aliases: ["playvideo", "pvid"],
    category: "downloader",
    permissions: { coin: 10 },
    code: async (ctx) => {
        await warmStyle(ctx._client);

        const flag = ctx.flag({
            index: { type: "string", short: "i", default: "0" },
            res:   { type: "string", short: "r", default: "" }
        });
        const input = flag.input;

        if (!input)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "one last kiss - hikaru utada")}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "one last kiss - hikaru utada -i 2 -r 720")}\n` +
                ctx.format.generatesFlagInfo({
                    "-i <number>": "Pilihan pada data indeks (default: 0)",
                    "-r <number>": `Resolusi video (${RESOLUTIONS.join(", ")} | kosong = pilih via button)`
                })
            );

        let res = flag.res ? String(flag.res).replace(/p$/i, "") : null;
        if (res && !RESOLUTIONS.includes(res)) {
            return await ctx.reply(
                ctx.format.info(`(｡•́︿•̀｡) Resolusi tidak sah.\n♡ Pilihan: ${RESOLUTIONS.join(", ")}`)
            );
        }

        try {
            const searchIndex = parseInt(flag.index, 10) || 0;
            let video;

            if (ctx.helper.isUrl(input)) {
                video = { title: "YouTube", channel: "-", url: input };
            } else {
                const searchApiUrl = ctx.api.createUrl("nexray", "/search/youtube", { q: input });
                video = (await ctx.request.get(searchApiUrl)).data.result?.[searchIndex];
                if (!video) return await ctx.reply(ctx.format.info(config.msg.notFound));
            }

            const info = {
                title:    video.title || video.name || "Unknown",
                channel:  video.channel || video.author || video.uploader || video.artist || "-",
                duration: fmtDuration(video.duration ?? video.length ?? video.timestamp ?? video.time),
                views:    fmtViews(video.views ?? video.viewCount ?? video.view_count ?? video.viewsCount),
                uploaded: fmtDate(video.uploaded ?? video.uploadDate ?? video.published ?? video.ago ?? video.date),
                thumbnail: video.thumbnail || video.thumb || video.image || video.cover
            };

            if (!res) {
                res = await askQuality(ctx, info);
                if (!res)
                    return await ctx.reply(
                        ctx.format.info("(｡•́︿•̀｡) Timeout / batal — tidak ada kualiti dipilih.")
                    );
            }

            await ctx.reply({
                text:
                    "╭───────────────୨୧\n" +
                    "│  ₊˚⊹♡  𝑵𝒐𝒘 𝑾𝒂𝒕𝒄𝒉𝒊𝒏𝒈  ♡⊹˚₊\n" +
                    "│ (｡･ω･｡)ﾉ Sedang menyiapkan video untukmu~ ✧\n" +
                    "╰───────────────୨୧\n\n" +
                    buildVideoInfoBlock(info) + "\n\n" +
                    `♡ Kualiti  › ${res}p\n` +
                    "♡ Sumber   › yt-dlp (fallback: API)",
                footer: config.msg.footer,
                contextInfo: buildContextInfo()
            });

            if (config.system.autoTypingOnCmd) await ctx.simulateTyping();

            let dl;
            let fixed;
            try {
                dl = await fetchVideo(ctx, video.url, res);
                fixed = await ensureWhatsApp(dl.file);
            } finally {
                if (dl) dl.cleanup();
            }

            const sourceTag = dl.source === "nexray" ? "nexray" : "yt-dlp";
            const mb = fixed.size / 1048576;

            if (mb <= VIDEO_MAX_MB) {
                const cap =
                    `❖ ${ctx.format.bold(info.title)}\n` +
                    `♡ Kualiti: ${res}p · ${mb.toFixed(1)} MB · ${sourceTag}` +
                    (fixed.silent
                        ? "\n♡ Nota: sumber ini tiada audio, cuba 360 atau 480."
                        : "");
                return await ctx.reply({
                    video: fixed.buffer,
                    mimetype: "video/mp4",
                    caption: cap,
                    contextInfo: buildContextInfo()
                });
            }

            const estParts = Math.min(
                MAX_ALBUM_PARTS,
                Math.max(2, Math.ceil(mb / VIDEO_MAX_MB))
            );
            const choice = await askOversizeAction(ctx, mb, estParts);

            if (choice !== "album") {
                return await ctx.reply({
                    document: fixed.buffer,
                    mimetype: "video/mp4",
                    fileName:
                        String(info.title || "video")
                            .replace(/[\\/:*?"<>|]/g, "")
                            .slice(0, 60) + ".mp4",
                    caption:
                        `❖ ${ctx.format.bold(info.title)}\n` +
                        `♡ Kualiti: ${res}p · ${mb.toFixed(1)} MB · ${sourceTag}`,
                    contextInfo: buildContextInfo()
                });
            }

            await ctx.reply({
                text: `🎞️ Memecahkan video kepada ${estParts} part...`,
                footer: config.msg.footer,
                contextInfo: buildContextInfo()
            });

            const id = Date.now() + "_" + Math.random().toString(36).slice(2, 6);
            const fullFile = `/tmp/pvfull_${id}.mp4`;
            fs.writeFileSync(fullFile, fixed.buffer);

            let split;
            try {
                split = await splitVideo(fullFile, VIDEO_MAX_MB * 1048576);
            } finally {
                try { fs.unlinkSync(fullFile); } catch (_) {}
            }

            const { buffers, count } = split;
            const parts = buffers.map((buf, i) => {
                const partMb = (buf.length / 1048576).toFixed(1);
                return {
                    video: buf,
                    mimetype: "video/mp4",
                    caption:
                        `❖ ${ctx.format.bold(info.title)} [${i + 1}/${count}]\n` +
                        `♡ ${res}p · ${partMb} MB`,
                    contextInfo: buildContextInfo()
                };
            });

            try {
                await ctx._self.sendMessage(
                    ctx._resolveSendJid(ctx.id),
                    { album: parts },
                    { quoted: ctx._msg }
                );
            } catch (_) {
                for (const p of parts) {
                    await ctx._self.sendMessage(
                        ctx._resolveSendJid(ctx.id),
                        p,
                        { quoted: ctx._msg }
                    );
                }
            }

        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
};