const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

// ╭───────────────୨୧
// │ STYLE
// ╰───────────────୨୧

const STYLE = {
    dir: "/root/kryznetwabot/",
    headerMode: "none",
    videoFile: "hero_tiny.mp4",
    videoIsGif: false,
    fallbackImage: null,
    enableForward: true,
    forwardScore: 5,
    enableChannel: true,
    channelInvite: "0029Vb8RP9f3bbV0ST0ZrL0X",
    channelName: "Kryz | Cloud & Hosting",
    channelServerId: 1,
    enableAdReply: false,
    adTitle: "Kryz-Net · Premium Cloud",
    adBody: "Fast VPS · Bot Hosting · 24/7 Support",
    adSourceUrl: "https://founder.kryz-net.space",
    adThumbFile: "thumb.jpg",
    adRenderLarge: false
};

const RESOLUTIONS = ["360", "480", "720", "1080"];
const DEFAULT_RES = "480";
const VIDEO_MAX_MB = 60;
const YTDLP_TIMEOUT_MS = 300_000;

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

// ╭───────────────୨୧
// │ STYLE HELPERS
// ╰───────────────୨୧

let _cache = null, _promise = null;

const warmStyle = (sock) => {
    if (_cache) return Promise.resolve(_cache);
    if (_promise) return _promise;
    _promise = (async () => {
        const c = { videoBuffer: null, thumbBuffer: null, newsletterJid: null };
        if (STYLE.headerMode === "video") {
            try {
                const vp = STYLE.dir + STYLE.videoFile;
                if (fs.existsSync(vp)) c.videoBuffer = fs.readFileSync(vp);
            } catch (_) {}
        }
        try {
            const tp = STYLE.dir + STYLE.adThumbFile;
            if (fs.existsSync(tp)) c.thumbBuffer = fs.readFileSync(tp);
        } catch (_) {}
        if (STYLE.enableChannel) {
            try {
                const meta = await sock.newsletterMetadata("invite", STYLE.channelInvite);
                c.newsletterJid = meta?.id;
            } catch (_) {}
        }
        _cache = c;
        _promise = null;
        return c;
    })();
    return _promise;
};

const buildStyle = () => {
    const c = _cache || {};
    const contextInfo = {};
    if (STYLE.enableForward) {
        contextInfo.forwardingScore = STYLE.forwardScore;
        contextInfo.isForwarded = true;
    }
    if (STYLE.enableChannel && c.newsletterJid) {
        contextInfo.forwardedNewsletterMessageInfo = {
            newsletterJid: c.newsletterJid,
            newsletterName: STYLE.channelName,
            serverMessageId: STYLE.channelServerId
        };
    }
    if (STYLE.enableAdReply) {
        contextInfo.externalAdReply = {
            title: STYLE.adTitle,
            body: STYLE.adBody,
            mediaType: 1,
            sourceUrl: STYLE.adSourceUrl,
            renderLargerThumbnail: STYLE.adRenderLarge,
            showAdAttribution: false,
            ...(c.thumbBuffer ? { thumbnail: c.thumbBuffer } : {})
        };
    }
    return { contextInfo };
};

const buildHeaderMedia = () => {
    const c = _cache || {};
    const fallback = { image: { url: STYLE.fallbackImage || config.bot.thumbnail } };
    if (STYLE.headerMode === "none") return {};
    if (STYLE.headerMode === "image") return fallback;
    if (STYLE.headerMode === "video") {
        if (c.videoBuffer) return { video: c.videoBuffer, gifPlayback: STYLE.videoIsGif };
        return fallback;
    }
    return {};
};

const styledReply = (ctx, payload) => {
    const { contextInfo } = buildStyle();
    const hasMedia = !!(payload.video || payload.image || payload.album);
    const content = hasMedia
        ? { ...payload, contextInfo }
        : (() => {
            const { caption, ...rest } = payload;
            return { ...rest, text: caption, contextInfo };
        })();
    return ctx.reply(content);
};

const styledAudio = (ctx, audioPayload) => {
    const { contextInfo } = buildStyle();
    return ctx._self.sendMessage(
        ctx._resolveSendJid(ctx.id),
        { ...audioPayload, contextInfo },
        { quoted: ctx._msg }
    );
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

// Sniff the first bytes: a real MP3 starts with an ID3 tag or an MPEG frame
// sync (0xFF 0xEx/0xFx). Guards against a CDN that answers 200 with HTML.
const isMp3File = (file) => {
    try {
        const fd = fs.openSync(file, "r");
        const head = Buffer.alloc(4);
        const n = fs.readSync(fd, head, 0, 4, 0);
        fs.closeSync(fd);
        if (n < 4) return false;
        if (head.toString("latin1", 0, 3) === "ID3") return true;
        return head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
    } catch (_) {
        return false;
    }
};

// An MP4/M4A carries an ISO-BMFF "ftyp" box at offset 4.
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
        console.warn(`[play] cookies.txt missing at ${YTDLP_COOKIES}.`);
    } else {
        try {
            const head = fs.readFileSync(YTDLP_COOKIES, "utf8").split(/\r?\n/, 1)[0];
            if (!/Netscape HTTP Cookie File|HTTP Cookie File/i.test(head)) {
                console.warn(`[play] cookies.txt not Netscape format`);
            } else {
                console.log(`[play] cookies.txt OK`);
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
        return "PO Token gagal. Semak bgutil-pot.";
    if (/n challenge solving failed/i.test(s))
        return "Deno tidak dijumpai.";
    if (/Video unavailable|Private video|removed|age-restricted/i.test(s))
        return "Video tidak tersedia / private / age-restricted.";
    if (/HTTP Error 429|Too Many Requests/i.test(s))
        return "YouTube rate-limit (429).";
    if (/Requested format is not available/i.test(s))
        return "Format tidak tersedia.";
    if (code) return `yt-dlp exit ${code}: ${s.slice(-200)}`;
    return "yt-dlp gagal: " + s.slice(-200);
};

// ╭───────────────୨୧
// │ PRIMARY: yt-dlp (video)
// ╰───────────────୨୧

const ytdlpVideo = async (url, res) => {
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const outTemplate = `/tmp/pv_${id}.%(ext)s`;

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
        console.log(`[play] cookies rejected — retrying without cookies`);
        dl = await run("yt-dlp", baseArgs, YTDLP_TIMEOUT_MS, env);
    }

    const files = fs.readdirSync("/tmp").filter((f) => f.startsWith(`pv_${id}.`));
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
// │ PRIMARY: yt-dlp (audio MP3)
// ╰───────────────୨୧

const ytdlpAudio = async (url) => {
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const outTemplate = `/tmp/pa_${id}.%(ext)s`;

    const baseArgs = [
        "--no-warnings", "--no-playlist", "--no-progress",
        "--retries", "3", "--socket-timeout", "30",
        "--concurrent-fragments", "4",
        "--no-part",
        "--cache-dir", YTDLP_CACHE,
        "--extractor-args", `youtube:player_client=${YTDLP_CLIENTS};fetch_pot=always`,
        "-f", "ba/b",
        "-x", "--audio-format", "mp3", "--audio-quality", "128K",
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
        console.log(`[play] cookies rejected — retrying without cookies`);
        dl = await run("yt-dlp", baseArgs, YTDLP_TIMEOUT_MS, env);
    }

    const files = fs.readdirSync("/tmp").filter((f) => f.startsWith(`pa_${id}.`));
    const cleanup = () => {
        for (const f of files) {
            try { fs.unlinkSync(path.join("/tmp", f)); } catch (_) {}
        }
    };

    if (!files.length) {
        cleanup();
        throw new Error(friendlyYtdlpError(dl.se, dl.e?.code));
    }

    let outFile = path.join("/tmp", files.find((f) => f.endsWith(".mp3")) || files[0]);
    if (!fs.existsSync(outFile)) outFile = path.join("/tmp", files[0]);

    const buffer = fs.readFileSync(outFile);
    cleanup();
    return { buffer, size: buffer.length, source: "yt-dlp" };
};

// ╭───────────────୨୧
// │ FALLBACK: nexray API
// ╰───────────────୨୧

const apiVideo = async (ctx, url, res) => {
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

    // Same dead-CDN trap as audio: an HTML landing page passes the size guard.
    // An MP4 has an "ftyp" box at offset 4.
    if (!isMp4File(outFile)) {
        cleanup();
        throw new Error("API memulangkan fail bukan video (HTML).");
    }

    return { file: outFile, cleanup, source: "nexray" };
};

const apiAudio = async (ctx, url) => {
    const apiUrl = ctx.api.createUrl("nexray", "/downloader/savetube", {
        url,
        quality: "mp3"
    });
    const resp = await ctx.request.get(apiUrl);
    const direct = resp?.data?.result?.url;
    if (!direct) throw new Error("API tidak memulangkan URL.");

    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const outFile = `/tmp/paapi_${id}.mp3`;

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

    // A dead CDN answers with its HTML landing page (HTTP 200), which the size
    // guard above waves through — WhatsApp then rejects it as unplayable. An
    // MP3 always starts with an ID3 tag or an MPEG frame sync.
    if (!isMp3File(outFile)) {
        cleanup();
        throw new Error("API memulangkan fail bukan audio (HTML).");
    }

    const buffer = fs.readFileSync(outFile);
    cleanup();
    return { buffer, size: buffer.length, source: "nexray" };
};

// ╭───────────────୨୧
// │ UNIFIED FETCHERS
// ╰───────────────୨୧

const fetchVideo = async (ctx, url, res) => {
    try {
        return await ytdlpVideo(url, res);
    } catch (ytErr) {
        console.warn(`[play] yt-dlp video failed: ${ytErr.message}`);
        await notifyOwner(
            ctx,
            "ytdlp-video-fail",
            `*yt-dlp gagal — fallback ke API (video)*\n` +
            `♡ URL    › ${truncate(url, 60)}\n` +
            `♡ Res    › ${res}p\n` +
            `♡ Sebab  › ${truncate(ytErr.message, 200)}\n\n` +
            `Semak cookies / bgutil bila sempat.`
        ).catch(() => {});
    }

    try {
        return await apiVideo(ctx, url, res);
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

const fetchAudio = async (ctx, url) => {
    try {
        return await ytdlpAudio(url);
    } catch (ytErr) {
        console.warn(`[play] yt-dlp audio failed: ${ytErr.message}`);
        await notifyOwner(
            ctx,
            "ytdlp-audio-fail",
            `*yt-dlp gagal — fallback ke API (audio)*\n` +
            `♡ URL    › ${truncate(url, 60)}\n` +
            `♡ Sebab  › ${truncate(ytErr.message, 200)}`
        ).catch(() => {});
    }

    try {
        return await apiAudio(ctx, url);
    } catch (apiErr) {
        await notifyOwner(
            ctx,
            "both-audio-fail",
            `⚠️ *Kedua-dua sumber gagal (audio)*\n` +
            `♡ URL    › ${truncate(url, 60)}\n` +
            `♡ API    › ${truncate(apiErr.message, 200)}`
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

const ensureWhatsAppVideo = async (inputFile) => {
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const outFile = `/tmp/pw_${id}.mp4`;
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
// │ INFO BLOCK
// ╰───────────────୨୧

const buildInfoBlock = (info, { wantsVideo, res, source }) => {
    const lines = ["╭┈┈┈┈┈┈┈┈୨୧", `┊ ✦ 𝑰𝒏𝒇𝒐 ${wantsVideo ? "𝑽𝒊𝒅𝒆𝒐" : "𝑳𝒂𝒈𝒖"} ୨୧`];
    const push = (label, value) => {
        if (value === null || value === undefined || value === "" || value === "-") return;
        lines.push(`┊ ♡ ${label.padEnd(8)} › ${value}`);
    };
    push("Judul",   truncate(info.title, 45));
    if (!wantsVideo && info.artist && info.artist !== "-") {
        push("Artis", truncate(info.artist, 35));
    } else {
        push("Channel", truncate(info.channel, 35));
    }
    push("Durasi",  info.duration);
    push("Views",   info.views);
    push("Upload",  info.uploaded);
    lines.push(`┊ ❖ Sumber  › ${String(source || "").toUpperCase()} ♡`);
    if (wantsVideo && res) lines.push(`┊ ♡ Kualiti  › ${res}p`);
    lines.push("╰┈┈┈┈┈┈┈┈୨୧");
    return lines.join("\n");
};

const normaliseInfo = (raw) => ({
    title:    raw?.title || raw?.name || "Unknown",
    channel:  raw?.channel || raw?.author || raw?.uploader || raw?.artist || "-",
    artist:   raw?.artist || raw?.channel || raw?.author || raw?.uploader || "-",
    duration: fmtDuration(raw?.duration ?? raw?.length ?? raw?.timestamp ?? raw?.time),
    views:    fmtViews(raw?.views ?? raw?.viewCount ?? raw?.view_count ?? raw?.viewsCount),
    uploaded: fmtDate(raw?.uploaded ?? raw?.uploadDate ?? raw?.published ?? raw?.ago ?? raw?.date),
    thumbnail: raw?.thumbnail || raw?.thumb || raw?.image || raw?.cover,
    url: raw?.url || raw?.link
});

// ╭───────────────୨୧
// │ FORMAT PICKER
// ╰───────────────୨୧

const pickerRows = (prefix, url) => [
    {
        title: "♪ Audio MP3",
        description: "❀ Saiz kecil · simpan sebagai lagu",
        id: `${prefix}play ${url} -f audio`
    },
    ...RESOLUTIONS.map((r) => {
        const m = RES_META[r];
        const star = r === DEFAULT_RES ? " ⭐" : "";
        return {
            title: `${m.emoji} Video ${r}p${star}`,
            description: `❀ ${m.tag} · ${m.hint}`,
            id: `${prefix}play ${url} -f video -r ${r}`
        };
    })
];

// ╭───────────────୨୧
// │ COMMAND
// ╰───────────────୨୧

module.exports = {
    name: "play",
    category: "downloader",
    permissions: { coin: 10 },
    code: async (ctx) => {
        await warmStyle(ctx._client);

        const flag = ctx.flag({
            index:  { type: "string", short: "i", default: "0" },
            source: { type: "string", short: "s", default: "youtube" },
            format: { type: "string", short: "f", default: "" },
            res:    { type: "string", short: "r", default: "" }
        });
        const input = flag.input;

        if (!input)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "one last kiss - hikaru utada -i 8 -s spotify")}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "one last kiss - hikaru utada -f video -r 720")}\n` +
                ctx.format.generatesFlagInfo({
                    "-i <number>": "Pilihan pada data indeks",
                    "-s <text>": "Sumber (spotify, youtube | default: youtube)",
                    "-f <text>": "Format (audio atau video | default: audio)",
                    "-r <number>": `Resolusi video (${RESOLUTIONS.join(", ")} | default: ${DEFAULT_RES})`
                })
            );

        try {
            const searchIndex = parseInt(flag.index, 10) || 0;
            const source = String(flag.source || "youtube").toLowerCase();
            const isLink = ctx.helper.isUrl(input);

            const fmt = String(flag.format || "").toLowerCase();
            let res = String(flag.res || "").replace(/p$/i, "");
            const wantsVideo = fmt === "video" || (!fmt && !!res);

            if (isLink && !fmt && !res) {
                return await styledReply(ctx, {
                    caption:
                        "╭───────────────୨୧\n" +
                        "│  ₊˚⊹♡  𝑷𝒊𝒍𝒊𝒉 𝑭𝒐𝒓𝒎𝒂𝒕  ♡⊹˚₊\n" +
                        "│ (｡･ω･｡)ﾉ Mahu audio atau video?\n" +
                        "╰───────────────୨୧\n\n" +
                        `❖ ${ctx.format.bold("URL")}: ${truncate(input, 60)}`,
                    footer: config.msg.footer,
                    optionText: "♪ Pilih Format",
                    optionTitle: "❀ Format Download",
                    nativeFlow: [{
                        text: "♪ Pilih Format",
                        sections: [{
                            title: "❀ Audio / Video",
                            highlight_label: "♡",
                            rows: pickerRows(ctx.used.prefix, input)
                        }]
                    }]
                });
            }

            if (wantsVideo) {
                if (source === "spotify")
                    return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Video hanya untuk sumber YouTube."));
                if (!res) res = DEFAULT_RES;
                if (!RESOLUTIONS.includes(res))
                    return await ctx.reply(
                        ctx.format.info(`(｡•́︿•̀｡) Resolusi tidak sah.\n♡ Pilihan: ${RESOLUTIONS.join(", ")}`)
                    );
            }

            const header = buildHeaderMedia();

            // ── SPOTIFY (API only) ──
            if (source === "spotify" && !isLink) {
                const searchApiUrl = ctx.api.createUrl("nexray", "/search/spotify", { q: input });
                const raw = (await ctx.request.get(searchApiUrl)).data.result?.[searchIndex];
                if (!raw) return await ctx.reply(ctx.format.info(config.msg.notFound));

                const info = normaliseInfo(raw);

                await styledReply(ctx, {
                    ...header,
                    caption:
                        "╭───────────────୨୧\n" +
                        "│  ₊˚⊹♡  𝑵𝒐𝒘 𝑷𝒍𝒂𝒚𝒊𝒏𝒈  ♡⊹˚₊\n" +
                        "│ (｡･ω･｡)ﾉ Sedang menyiapkan lagu untukmu~ ✧\n" +
                        "╰───────────────୨୧\n\n" +
                        buildInfoBlock(info, { wantsVideo: false, source: "spotify" }),
                    footer: config.msg.footer
                });

                const downloadApiUrl = ctx.api.createUrl("nexray", "/downloader/spotify", {
                    url: raw.url
                });
                const audioUrl = (await ctx.request.get(downloadApiUrl)).data.result.url;

                if (config.system.autoTypingOnCmd) await ctx.simulateTyping();

                return styledAudio(ctx, {
                    audio: { url: audioUrl },
                    mimetype: "audio/mpeg",
                    fileName: `${info.title}.mp3`
                });
            }

            // ── YOUTUBE ──
            let raw;
            if (isLink) {
                raw = { title: "YouTube", channel: "-", url: input };
            } else {
                const searchApiUrl = ctx.api.createUrl("nexray", "/search/youtube", { q: input });
                raw = (await ctx.request.get(searchApiUrl)).data.result?.[searchIndex];
                if (!raw) return await ctx.reply(ctx.format.info(config.msg.notFound));
            }

            const info = normaliseInfo(raw);

            await styledReply(ctx, {
                ...header,
                caption:
                    "╭───────────────୨୧\n" +
                    `│  ₊˚⊹♡  𝑵𝒐𝒘 ${wantsVideo ? "𝑾𝒂𝒕𝒄𝒉𝒊𝒏𝒈" : "𝑷𝒍𝒂𝒚𝒊𝒏𝒈"}  ♡⊹˚₊\n` +
                    `│ (｡･ω･｡)ﾉ Sedang menyiapkan ${wantsVideo ? "video" : "lagu"} untukmu~ ✧\n` +
                    "╰───────────────୨୧\n\n" +
                    buildInfoBlock(info, { wantsVideo, res, source: "youtube" }) +
                    "\n\n♡ Sumber  › yt-dlp (fallback: API)",
                footer: config.msg.footer
            });

            if (config.system.autoTypingOnCmd) await ctx.simulateTyping();

            if (wantsVideo) {
                let dl;
                try {
                    dl = await fetchVideo(ctx, info.url, res);
                    const fixed = await ensureWhatsAppVideo(dl.file);
                    const mb = fixed.size / 1048576;
                    const sourceTag = dl.source === "nexray" ? "nexray" : "yt-dlp";
                    const cap =
                        `❖ ${ctx.format.bold(info.title)}\n` +
                        `♡ Kualiti: ${res}p · ${mb.toFixed(1)} MB · ${sourceTag}` +
                        (fixed.silent
                            ? "\n♡ Nota: sumber ini tiada audio, cuba 360 atau 480."
                            : "");

                    if (mb <= VIDEO_MAX_MB) {
                        await styledReply(ctx, {
                            video: fixed.buffer,
                            mimetype: "video/mp4",
                            caption: cap
                        });
                    } else {
                        await ctx.reply({
                            document: fixed.buffer,
                            mimetype: "video/mp4",
                            fileName:
                                String(info.title || "video")
                                    .replace(/[\\/:*?"<>|]/g, "")
                                    .slice(0, 60) + ".mp4",
                            caption: cap
                        });
                    }
                } finally {
                    if (dl) dl.cleanup();
                }
            } else {
                const audio = await fetchAudio(ctx, info.url);
                const mb = audio.size / 1048576;
                const sourceTag = audio.source === "nexray" ? "nexray" : "yt-dlp";
                await styledAudio(ctx, {
                    audio: audio.buffer,
                    mimetype: "audio/mpeg",
                    fileName: `${info.title}.mp3`,
                    ptt: false,
                    caption: `❖ ${info.title}\n♡ Audio · ${mb.toFixed(1)} MB · ${sourceTag}`
                });
            }

        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
};