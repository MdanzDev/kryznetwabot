// Telegram bridge for kryznetwabot — v3.
// Alya persona, access control (owner/allowed/stranger), persistent state,
// YT search w/ inline buttons, stickers, voice transcription, long-answer mode,
// reminders/cron, group admin tools, rate limit, model health routing, usage stats.

const https = require("node:https");
const { exec } = require("node:child_process");
const path = require("node:path");
const { StateStore } = require("./state");
const { ALYA_PERSONA } = require("./persona");
const { Scheduler } = require("./scheduler");
const { GroupAdmin } = require("./groupadmin");
const { LongMemory } = require("./memory");
const { Soul } = require("./soul");
const { Analytics } = require("./analytics");
const { execFile } = require("node:child_process");

// ==================== MODEL ROUTER ====================
// COST-FIRST policy: cheapest multiplier that can do the job wins. Always.
// Expensive models (5x+) are opt-in only via /model force — never auto-picked.
const MODELS = {
    cheap: ["glm-5.1", "kimi-k2.7-code", "hy3"],             // 1x, 1x, 1.4x — normal chat
    mid: ["deepseek-v4-pro", "deepseek-v4-mod", "glm-5.2"],  // 1.15x, 1.25x, 1.25x — reasoning/code
    strong: ["glm-5.3", "deepseek-v4-flash"],                // 2x, 2x — hard tasks (flash = A-grade)
    vision: ["deepseek-v4-flash-vision-exp", "kimi-k3", "kimi-k3-mod"], // 2.5x, 2x, 2x — images only
    tools: ["kimi-k2.7-code", "glm-5.1", "deepseek-v4-pro"], // 1x, 1x, 1.15x — JSON actions
    stt: ["kimi-k3"]                                          // 2x — audio transcription, cheapest vision/audio-capable
};

// Provider pricing (Jack's plan): multiplier x base rate. Base rate derived
// from best package: Rp 190.000 / 1B tokens = Rp 0,19 per 1x-token.
const IDR_PER_UNIT_TOKEN = 0.19; // Rp per token at 1x multiplier
const MODEL_MULTIPLIERS = {
    "auto": 1, "glm-5.1": 1, "hy3": 1.4, "kimi-k2.7-code": 1, "kimi-k2.7-code-highspeed": 1.5,
    "deepseek-v4-pro": 1.15, "deepseek-v4-mod": 1.25, "glm-5.2": 1.25, "glm-5.2-mod": 1.25,
    "mimo-v2.5-pro": 1.4, "minimax-m3": 1.4, "hy4": 1.4,
    "glm-5.3": 2, "glm-5.3-flash": 2, "glm-5.3-mod": 2, "deepseek-v4-flash": 2,
    "deepseek-v4-flash-0731": 2, "kimi-k3": 2, "kimi-k3-mod": 2,
    "deepseek-v4-flash-vision-exp": 2.5, "deepseek-v4.1-flash": 2.56,
    "gpt-5.6": 5, "gpt-5.6-luna": 5, "gpt-5.6-terra": 10, "gpt-5.6-sol": 15, "claude-opus-5": 12
};

const COMPLEX_HINT = /(why|how does|explain|analyze|analis|compare|banding|debug|refactor|architecture|design|optimi[sz]e|review|step.?by.?step|buatkan|buatin|code|script|function|error|fix|deploy|database|sql)/i;
const TOOL_INTENT = /(download|tiktok|yt|youtube|spotify|instagram|fb |facebook|jalanin|jalankan|exec|terminal|shell|pm2|cek server|check server|sisa (disk|ram)|df -h|free -h|carikan|cariin|search)/i;
const LONG_HINT = /(full|lengkap|panjang|detail banget|selengkap|semua fitur|complete|entire|whole script|step by step)/i;
const REMIND_HINT = /(ingatkan|remind|ingetin|setiap hari|every day|tiap (hari|jam|pagi|malam)|daily)/i;

function pickTier({ hasImage, prompt, needsTools }) {
    if (hasImage) return "vision";
    if (needsTools) return "tools";
    const long = prompt.length > 500;
    const complex = COMPLEX_HINT.test(prompt);
    if (long && complex) return "strong";
    if (long || complex) return "mid";
    return "cheap";
}

const modelHealth = new Map();
function recordSuccess(tier, model) {
    modelHealth.set(model, 0);
    const list = MODELS[tier];
    const idx = list.indexOf(model);
    if (idx > 0) { list.splice(idx, 1); list.unshift(model); }
}
function recordFailure(tier, model) {
    const fails = (modelHealth.get(model) || 0) + 1;
    modelHealth.set(model, fails);
    if (fails >= 2) {
        const list = MODELS[tier];
        const idx = list.indexOf(model);
        if (idx >= 0 && idx < list.length - 1) { list.splice(idx, 1); list.push(model); }
    }
}

// ==================== USAGE STATS ====================
// Persisted in the telegram.json state store — survives pm2 restarts.
// Counters live here; StateStore batches disk writes every 30s.
let stats = null; // initialized in TelegramBot constructor via initStats()

function initStats(state) {
    stats = state.get("stats", {
        startedAt: Date.now(),
        calls: 0,
        tokens: 0,
        byModel: {},
        downloads: 0,
        execs: 0
    });
    stats._state = state;
    return stats;
}

function saveStats() {
    if (!stats?._state) return;
    const { _state, ...data } = stats;
    _state.set("stats", data);
}

function trackCall(model, usage) {
    if (!stats) return;
    stats.calls++;
    stats.tokens += usage?.total_tokens || 0;
    const e = stats.byModel[model] || { calls: 0, tokens: 0 };
    e.calls++;
    e.tokens += usage?.total_tokens || 0;
    stats.byModel[model] = e;
    // daily weighted cost accumulator (resets at KL midnight)
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    if (stats.dailyDate !== today) {
        stats.dailyDate = today;
        stats.dailyIDR = 0;
    }
    const mult = MODEL_MULTIPLIERS[model] || 1;
    stats.dailyIDR += (usage?.total_tokens || 0) * mult * IDR_PER_UNIT_TOKEN;
    saveStats();
}

// ==================== HTTP ====================
const agent = new https.Agent({ family: 4 });

function request(urlString, { method = "GET", headers = {}, body = null, timeoutMs = 90000, redirects = 3 } = {}) {
    return new Promise((resolve, reject) => {
        let url;
        try { url = new URL(urlString); } catch { return reject(new Error("bad URL")); }
        const req = https.request({
            hostname: url.hostname, path: url.pathname + url.search, method, agent,
            headers: { "User-Agent": "KryzAlyaBot/3.0 (personal telegram bot; contact: kryxtech0@gmail.com)", ...headers },
            timeout: timeoutMs
        }, (res) => {
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
                res.resume();
                const next = new URL(res.headers.location, urlString).toString();
                return request(next, { method, headers, body, timeoutMs, redirects: redirects - 1 }).then(resolve, reject);
            }
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks), headers: res.headers }));
        });
        req.on("timeout", () => req.destroy(new Error("request timeout")));
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

async function getJSON(urlString, timeoutMs = 60000) {
    try {
        const { status, buffer } = await request(urlString, { timeoutMs });
        return { status, json: JSON.parse(buffer.toString("utf8")) };
    } catch { return { status: 0, json: null }; }
}

async function postJSON(urlString, headers, payload, timeoutMs = 90000) {
    const body = Buffer.from(JSON.stringify(payload));
    const { status, buffer } = await request(urlString, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": body.length, ...headers },
        body, timeoutMs
    });
    try {
        return { status, json: JSON.parse(buffer.toString("utf8")) };
    } catch { return { status, json: null, raw: buffer.toString("utf8").slice(0, 300) }; }
}

async function headContentLength(urlString) {
    try {
        const { status, headers } = await request(urlString, { method: "HEAD", timeoutMs: 15000 });
        const len = parseInt(headers["content-length"] || "0", 10);
        return { status, length: Number.isFinite(len) ? len : 0 };
    } catch { return { status: 0, length: 0 }; }
}

const truncate = (text, limit = 3500) => {
    const s = String(text);
    return s.length <= limit ? s : s.slice(0, limit) + `\n...[trimmed ${s.length - limit} chars]`;
};

// ==================== RATE LIMITER ====================
const rateBuckets = new Map();
function checkRate(userId, limit = 10) {
    const now = Date.now();
    let b = rateBuckets.get(userId);
    if (!b || now >= b.resetAt) { b = { count: 0, resetAt: now + 60000 }; rateBuckets.set(userId, b); }
    b.count++;
    return b.count <= limit;
}

// ==================== TELEGRAM API ====================
const TG_LIMIT = 48 * 1024 * 1024;

class TelegramAPI {
    constructor(token) {
        this.base = `https://api.telegram.org/bot${token}`;
        this.fileBase = `https://api.telegram.org/file/bot${token}`;
    }

    async call(method, params = {}, timeoutMs = 60000) {
        const { status, json, raw } = await postJSON(`${this.base}/${method}`, {}, params, timeoutMs);
        if (!json?.ok) throw new Error(`TG ${method} (${status}): ${(raw || JSON.stringify(json || {})).slice(0, 200)}`);
        return json.result;
    }

    async sendMessage(chatId, text, extra = {}) {
        let remaining = String(text);
        const chunks = [];
        while (remaining.length > 4000) { chunks.push(remaining.slice(0, 4000)); remaining = remaining.slice(4000); }
        chunks.push(remaining || " ");
        for (let i = 0; i < chunks.length; i++) {
            const payload = { chat_id: chatId, text: chunks[i], ...(i === 0 ? extra : {}) };
            try { await this.call("sendMessage", payload); }
            catch { await this.call("sendMessage", { chat_id: chatId, text: chunks[i] }); }
        }
    }

    async sendChatAction(chatId, action = "typing") {
        await this.call("sendChatAction", { chat_id: chatId, action }, 10000).catch(() => {});
    }

    async _guardAndSend(method, chatId, field, url, caption, extra = {}) {
        const { length } = await headContentLength(url);
        if (length > TG_LIMIT) {
            return this.sendMessage(chatId, `(｡•́︿•̀｡) File-nya ${(length / 1048576).toFixed(0)}MB — kebesaran buat Telegram (max 50MB). Download langsung di sini ya~ (⁠｡⁠･⁠ω⁠･⁠｡⁠)\n${url}`);
        }
        await this.call(method, { chat_id: chatId, [field]: url, caption: truncate(caption || "", 1000), ...extra }, 120000);
    }

    sendVideo(chatId, url, caption) { return this._guardAndSend("sendVideo", chatId, "video", url, caption, { supports_streaming: true }); }
    sendAudio(chatId, url, caption, title) { return this._guardAndSend("sendAudio", chatId, "audio", url, caption, { title: title || undefined }); }
    sendDocument(chatId, url, caption) { return this._guardAndSend("sendDocument", chatId, "document", url, caption); }

    async sendPhoto(chatId, url, caption) {
        await this.call("sendPhoto", { chat_id: chatId, photo: url, caption: truncate(caption || "", 1000) }, 60000);
    }

    async answerCallback(id, text) {
        await this.call("answerCallbackQuery", { callback_query_id: id, text: text || "" }, 10000).catch(() => {});
    }

    async getFileBuffer(fileId) {
        const file = await this.call("getFile", { file_id: fileId });
        const { buffer, headers } = await request(`${this.fileBase}/${file.file_path}`, { timeoutMs: 60000 });
        return { buffer, contentType: headers["content-type"] || "application/octet-stream" };
    }
}

// ==================== AI CLIENT ====================
class AIClient {
    constructor(baseURL, apiKey) {
        this.baseURL = baseURL.replace(/\/$/, "");
        this.apiKey = apiKey;
        this.forcedModel = null;
    }

    async chat(model, messages, { timeoutMs = 90000, maxTokens = 1500 } = {}) {
        const { status, json, raw } = await postJSON(
            `${this.baseURL}/chat/completions`,
            { Authorization: `Bearer ${this.apiKey}` },
            { model, messages, max_tokens: maxTokens },
            timeoutMs
        );
        const choice = json?.choices?.[0];
        const content = choice?.message?.content;
        if (!content) throw new Error(`AI ${model} (${status}): ${(raw || JSON.stringify(json || {})).slice(0, 200)}`);
        return { content, usage: json?.usage, finishReason: choice?.finish_reason };
    }

    async chatWithFallback(tier, messages, opts = {}) {
        if (this.forcedModel) {
            const r = await this.chat(this.forcedModel, messages, opts);
            trackCall(this.forcedModel, r.usage);
            return { reply: r.content, model: this.forcedModel, finishReason: r.finishReason };
        }
        const list = [...(MODELS[tier] || MODELS.cheap)];
        let lastError = null;
        for (const model of list) {
            try {
                const r = await this.chat(model, messages, opts);
                recordSuccess(tier, model);
                trackCall(model, r.usage);
                return { reply: r.content, model, finishReason: r.finishReason };
            } catch (error) {
                console.log(`[TG-AI] ${model} failed: ${error.message}`);
                recordFailure(tier, model);
                lastError = error;
            }
        }
        throw lastError || new Error("no models available");
    }
}

// ==================== DOWNLOADER TOOLS ====================
const NEXRAY = "https://api.nexray.eu.cc";
const FAAA = "https://api-faa.my.id";
const extractUrl = (text) => (String(text).match(/https?:\/\/[^\s]+/) || [null])[0];

const TOOLS = {
    tiktok: {
        desc: "Download TikTok video/photo. args: tiktok URL",
        match: /tiktok\.com|vt\.tiktok/i,
        run: async (tg, chatId, args) => {
            const url = extractUrl(args);
            if (!url) return tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Kasih URL TikTok-nya ya~");
            await tg.sendChatAction(chatId, "upload_video");
            const { json } = await getJSON(`${NEXRAY}/downloader/tiktok?` + new URLSearchParams({ url }));
            const result = json?.result?.data;
            if (!result) return tg.sendMessage(chatId, "(╥﹏╥) Gagal download... link mati atau API lagi down. Coba lagi nanti ya~");
            if (!Array.isArray(result)) {
                await tg.sendVideo(chatId, result, `❖ TikTok\n${url}`).catch(() => tg.sendDocument(chatId, result, url));
            } else {
                for (const img of result.slice(0, 10)) await tg.sendPhoto(chatId, img).catch(() => {});
                await tg.sendMessage(chatId, `❖ TikTok (photo set)\n${url}`);
            }
        }
    },
    youtube: {
        desc: "Download YouTube video mp4. args: youtube URL",
        match: /youtube\.com|youtu\.be/i,
        run: async (tg, chatId, args) => {
            const url = extractUrl(args);
            if (!url) return tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Kasih URL YouTube-nya ya~");
            await tg.sendChatAction(chatId, "upload_video");
            const { json } = await getJSON(`${NEXRAY}/downloader/savetube?` + new URLSearchParams({ url }));
            const videoUrl = json?.result?.url || json?.result?.data || json?.data?.url;
            if (!videoUrl) {
                const alt = await getJSON(`${FAAA}/faa/ytmp4?` + new URLSearchParams({ url }));
                const altUrl = alt.json?.result?.url || alt.json?.result?.link;
                if (!altUrl) return tg.sendMessage(chatId, "(╥﹏╥) Gagal download YouTube-nya... coba lagi nanti ya~");
                return tg.sendVideo(chatId, altUrl, `❖ YouTube\n${url}`);
            }
            await tg.sendVideo(chatId, videoUrl, `❖ YouTube\n${url}`);
        }
    },
    ytmp3: {
        desc: "YouTube audio only (mp3). args: youtube URL",
        match: null,
        run: async (tg, chatId, args) => {
            const url = extractUrl(args);
            if (!url) return tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Kasih URL YouTube-nya ya~");
            await tg.sendChatAction(chatId, "upload_audio");
            const { json } = await getJSON(`${FAAA}/faa/ytmp3?` + new URLSearchParams({ url }));
            const audioUrl = json?.result?.url || json?.result?.link;
            if (!audioUrl) return tg.sendMessage(chatId, "(╥﹏╥) Gagal ambil mp3-nya... coba lagi nanti ya~");
            await tg.sendAudio(chatId, audioUrl, `❖ YouTube MP3\n${url}`);
        }
    },
    instagram: {
        desc: "Download Instagram reel/post. args: instagram URL",
        match: /instagram\.com|instagr\.am/i,
        run: async (tg, chatId, args) => {
            const url = extractUrl(args);
            if (!url) return tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Kasih URL Instagram-nya ya~");
            await tg.sendChatAction(chatId, "upload_video");
            const { json } = await getJSON(`${NEXRAY}/downloader/instagram?` + new URLSearchParams({ url }));
            const result = json?.result?.data || json?.result;
            const media = Array.isArray(result) ? result : (result ? [result] : []);
            if (!media.length) return tg.sendMessage(chatId, "(╥﹏╥) Gagal download Instagram-nya... coba lagi nanti ya~");
            for (const m of media.slice(0, 5)) {
                const murl = typeof m === "string" ? m : (m.url || m.link);
                if (!murl) continue;
                if (/\.(mp4|mov)/i.test(murl)) await tg.sendVideo(chatId, murl, `❖ Instagram\n${url}`).catch(() => {});
                else await tg.sendPhoto(chatId, murl, `❖ Instagram\n${url}`).catch(() => {});
            }
        }
    },
    facebook: {
        desc: "Download Facebook video. args: facebook URL",
        match: /facebook\.com|fb\.watch|fb\.com/i,
        run: async (tg, chatId, args) => {
            const url = extractUrl(args);
            if (!url) return tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Kasih URL Facebook-nya ya~");
            await tg.sendChatAction(chatId, "upload_video");
            const { json } = await getJSON(`${NEXRAY}/downloader/facebook?` + new URLSearchParams({ url }));
            const videoUrl = json?.result?.data || json?.result?.url || json?.result;
            const finalUrl = typeof videoUrl === "string" ? videoUrl : (videoUrl?.url || videoUrl?.hd || videoUrl?.sd);
            if (!finalUrl) return tg.sendMessage(chatId, "(╥﹏╥) Gagal download Facebook-nya... coba lagi nanti ya~");
            await tg.sendVideo(chatId, finalUrl, `❖ Facebook\n${url}`);
        }
    },
    spotify: {
        desc: "Download Spotify track as audio. args: spotify track URL",
        match: /spotify\.com/i,
        run: async (tg, chatId, args) => {
            const url = extractUrl(args);
            if (!url) return tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Kasih URL Spotify-nya ya~");
            await tg.sendChatAction(chatId, "upload_audio");
            const { json } = await getJSON(`${NEXRAY}/downloader/spotify?` + new URLSearchParams({ url }));
            const audioUrl = json?.result?.data || json?.result?.url || json?.result;
            const finalUrl = typeof audioUrl === "string" ? audioUrl : audioUrl?.url;
            if (!finalUrl) return tg.sendMessage(chatId, "(╥﹏╥) Gagal download Spotify-nya... coba lagi nanti ya~");
            await tg.sendAudio(chatId, finalUrl, `❖ Spotify\n${url}`);
        }
    }
};

// ==================== TERMINAL TOOL ====================
const EXEC_TIMEOUT = 55000;

function runShell(command) {
    return new Promise((resolve) => {
        exec(command, { cwd: "/root", timeout: EXEC_TIMEOUT, maxBuffer: 1024 * 1024, shell: "/bin/bash" }, (error, stdout, stderr) => {
            resolve({
                command,
                code: error && typeof error.code === "number" ? error.code : 0,
                killed: Boolean(error?.killed),
                stdout: (stdout || "").trim(),
                stderr: (stderr || "").trim()
            });
        });
    });
}

// ==================== TELEGRAM BOT ====================
class TelegramBot {
    constructor(bot, tgConfig) {
        this.bot = bot;
        this.config = tgConfig;
        this.tg = new TelegramAPI(tgConfig.token);
        this.ai = new AIClient(tgConfig.ai.baseURL, tgConfig.ai.apiKey);
        this.lastUpdateId = 0;
        this.running = false;
        this.state = new StateStore(tgConfig.stateFile || path.join(__dirname, "..", "..", "database", "telegram.json"));
        initStats(this.state);
        this.histories = new Map(Object.entries(this.state.get("histories", {})));
        this.groupAdmin = new GroupAdmin(this.state, this.tg);
        this.scheduler = new Scheduler(this.state, (chatId, text) => this.tg.sendMessage(chatId, text));
        this.memory = new LongMemory(this.state);
        this.soul = new Soul(this.state, tgConfig.ownerIds || []);
        this.analytics = new Analytics(this.state);
        this.callMode = new Map();   // chatId -> expiryTs (/call voice loop)
        this.brainMode = new Map();  // chatId -> bool (multi-brain debate)
        this.pollFailures = 0;
        this.pendingSearches = new Map(); // callbackData -> { chatId, url, kind }
    }

    isOwner(userId) { return (this.config.ownerIds || []).includes(userId); }
    isAllowed(userId) {
        if (this.isOwner(userId)) return true;
        const allowed = this.state.get("allowedUsers", []);
        return allowed.includes(userId);
    }

    async start() {
        const me = await this.tg.call("getMe");
        this.me = me;
        await this.tg.call("setMyCommands", {
            commands: [
                { command: "start", description: "Apa yang bisa Kryzz lakukan" },
                { command: "reset", description: "Reset riwayat percakapan" },
                { command: "id", description: "Lihat user ID kamu" },
                { command: "voice", description: "Toggle jawaban pakai suara (VN)" },
                { command: "call", description: "Mode telepon 5 menit (voice loop)" },
                { command: "endcall", description: "Akhiri mode telepon" },
                { command: "relationship", description: "Status hubungan kamu sama Alya" },
                { command: "alias", description: "Shortcut kata: /alias gas = pm2 status" },
                { command: "memories", description: "Lihat/hapus memori Alya soal kamu" },
                { command: "cost", description: "[owner] Laporan biaya AI" },
                { command: "analytics", description: "[owner] Analitik bot" },
                { command: "brain", description: "[owner] Toggle multi-brain debate" },
                { command: "remind", description: "Ingatkan: /remind 30m <pesan> | /remind daily 09:00 <pesan>" },
                { command: "reminders", description: "Lihat/hapus reminder (list | del <id>)" },
                { command: "model", description: "[owner] Lihat/paksa model AI" },
                { command: "stats", description: "[owner] Statistik pemakaian" },
                { command: "allow", description: "[owner] Izinkan user: /allow <userId>" },
                { command: "disallow", description: "[owner] Cabut izin user" },
                { command: "addowner", description: "[owner] Tambah owner baru" },
                { command: "welcome", description: "[group] Set pesan sambutan: /welcome <teks {name}> | off" },
                { command: "antilink", description: "[group] on/off anti-link" },
                { command: "autoreply", description: "[group] /autoreply <kata> = <jawaban>" },
                { command: "delreply", description: "[group] Hapus auto-reply" }
            ]
        }).catch(() => {});
        this.scheduler.start();
        this._startDigest();
        console.log(`[TG] Online as @${me.username} (${me.id})`);
        this.running = true;
        this.poll();
    }

    // Morning digest + nightly brain backup, checked hourly
    _startDigest() {
        setInterval(() => this._hourlyTasks(), 3600000).unref?.();
        setTimeout(() => this._hourlyTasks(), 15000); // first run shortly after boot
    }

    async _hourlyTasks() {
        const klNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
        const hour = klNow.getHours();
        const dateKey = klNow.toLocaleDateString("en-CA");
        const marker = this.state.get("hourlyMarkers", {});

        // 7am: proactive morning greeting + digest to owners
        if (hour === 7 && marker.digest !== dateKey) {
            marker.digest = dateKey;
            this.state.set("hourlyMarkers", marker);
            for (const ownerId of this.config.ownerIds || []) {
                this._sendMorningDigest(ownerId).catch((e) => console.error("[TG-digest]", e.message));
            }
        }

        // 3am: brain backup to private git repo
        if (hour === 3 && marker.backup !== dateKey) {
            marker.backup = dateKey;
            this.state.set("hourlyMarkers", marker);
            this._brainBackup().catch((e) => console.error("[TG-backup]", e.message));
        }
    }

    async _sendMorningDigest(chatId) {
        const klNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
        const dateStr = klNow.toLocaleDateString("id-ID", { timeZone: "Asia/Kuala_Lumpur", weekday: "long", day: "numeric", month: "long", year: "numeric" });
        const mood = this.soul.getMood();
        let weatherLine = "";
        const w = await this.getWeather("Kuala Lumpur").catch(() => null);
        if (w) {
            weatherLine = `\n🌤️ Cuaca KL: ${w.tempC}°C, ${w.desc.toLowerCase()}, lembap ${w.humidity}%` +
                (parseFloat(w.precipMM) > 0 ? " — bawa payung ya sayang! ☔" : "");
        }
        const todaysReminders = this.scheduler.jobs
            .filter((j) => j.chatId === chatId && j.at && j.at - Date.now() < 86400000)
            .map((j) => `  ⏰ ${j.text.replace(/^.*?♡ /, "")}`)
            .join("\n");
        await this.tg.sendMessage(chatId,
            `(⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡ Selamat pagi sayang~\n\n` +
            `�� Hari ini ${dateStr}` + weatherLine +
            `\n�� Mood Alya hari ini: ${mood}` +
            (todaysReminders ? `\n\nPengingat hari ini:\n${todaysReminders}` : "") +
            `\n\nJangan lupa sarapan ya, nanti sakit lho~ Alya selalu di sini kalau kamu butuh apa-apa (⁠◕⁠ᴗ⁠◕⁠✿⁠)`);
    }

    async _brainBackup() {
        const fs = require("node:fs");
        const backupDir = "/root/alya-brain";
        const stateSrc = this.state.filePath;
        if (!fs.existsSync(stateSrc)) return;
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
            execFile("git", ["init", "-q", backupDir], () => {});
        }
        // strip nothing sensitive in telegram.json (tokens live in config.json, not here)
        fs.copyFileSync(stateSrc, path.join(backupDir, "telegram.json"));
        execFile("git", ["-C", backupDir, "add", "telegram.json"], () => {
            execFile("git", ["-C", backupDir, "commit", "-q", "-m", `brain snapshot ${new Date().toISOString()}`], (err) => {
                if (!err) console.log("[TG-backup] brain snapshot committed");
            });
        });
    }

    // Watchdog: alert owner over WA after 5 consecutive poll failures
    async _handlePollFailure(error) {
        this.pollFailures++;
        const backoff = Math.min(5000 * this.pollFailures, 60000);
        if (this.pollFailures === 5) {
            const ownerJid = `${this.config.waOwnerNumber || ""}@s.whatsapp.net`;
            if (this.config.waOwnerNumber && this.bot?.core?.sendMessage) {
                await this.bot.core.sendMessage(ownerJid, {
                    text: `⚠️ [Alya-TG] Telegram polling gagal 5x berturut-turut.\nError: ${error.message}\nCek: pm2 logs BotWa`
                }).catch(() => {});
            }
        }
        await new Promise((r) => setTimeout(r, backoff));
    }

    async poll() {
        while (this.running) {
            try {
                const updates = await this.tg.call("getUpdates", {
                    offset: this.lastUpdateId + 1,
                    timeout: 25,
                    allowed_updates: ["message", "callback_query"]
                }, 35000);
                this.pollFailures = 0;
                for (const update of updates) {
                    this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
                    if (update.callback_query) {
                        this.handleCallback(update.callback_query).catch((e) => console.error("[TG] callback:", e.message));
                        continue;
                    }
                    const msg = update.message;
                    if (!msg || msg.from?.is_bot) continue;

                    // Group admin layer first (welcome/antilink/autoreply)
                    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
                    if (isGroup) {
                        const handled = await this.groupAdmin.onMessage(msg).catch(() => false);
                        if (handled) continue;
                    }

                    if (!this.shouldRespond(msg)) continue;
                    this.handle(msg, (msg.text || msg.caption || "").trim()).catch((e) => {
                        console.error("[TG] handler:", e.message);
                        this.tg.sendMessage(msg.chat.id, "(╥﹏╥) Ups, ada error pas prosesnya! Coba lagi ya~").catch(() => {});
                    });
                }
            } catch (error) {
                console.error("[TG] poll:", error.message);
                await this._handlePollFailure(error);
            }
        }
    }

    shouldRespond(msg) {
        const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
        const text = (msg.text || msg.caption || "").trim();
        if (!text && !msg.photo?.length && !msg.voice) return false;
        if (!isGroup) return true;
        if (text.startsWith("/")) return true;
        if (this.me?.username && text.toLowerCase().includes(`@${this.me.username.toLowerCase()}`)) return true;
        if (msg.reply_to_message?.from?.id === this.me?.id) return true;
        if (extractUrl(text) && Object.values(TOOLS).some((t) => t.match && t.match.test(text))) return true;
        return false;
    }

    detectTool(prompt) {
        const url = extractUrl(prompt);
        if (!url) return null;
        for (const [name, tool] of Object.entries(TOOLS)) {
            if (tool.match && tool.match.test(url)) return { name, tool, url };
        }
        return null;
    }

    // ---------- YouTube search + inline buttons ----------
    async youtubeSearch(chatId, query) {
        await this.tg.sendChatAction(chatId, "typing");
        const { json } = await getJSON(`${NEXRAY}/search/youtube?` + new URLSearchParams({ q: query }));
        const items = (json?.result?.data || json?.result || json?.data || []).slice(0, 5);
        if (!items.length) return this.tg.sendMessage(chatId, "(╥﹏╥) Gak nemu apa-apa... coba kata kunci lain ya~");
        const buttons = [];
        const lines = [];
        items.forEach((it, i) => {
            const title = truncate(it.title || it.name || "video", 60);
            const url = it.url || it.link || (it.id ? `https://youtu.be/${it.id}` : null);
            if (!url) return;
            lines.push(`${i + 1}. ${title}`);
            const keyV = `sv_${Date.now()}_${i}_v`;
            const keyA = `sv_${Date.now()}_${i}_a`;
            this.pendingSearches.set(keyV, { url, kind: "youtube" });
            this.pendingSearches.set(keyA, { url, kind: "ytmp3" });
            buttons.push([
                { text: `🎬 ${i + 1} MP4`, callback_data: keyV },
                { text: `🎵 ${i + 1} MP3`, callback_data: keyA }
            ]);
        });
        if (!buttons.length) return this.tg.sendMessage(chatId, "(╥﹏╥) Hasilnya gak bisa dipakai... coba lagi ya~");
        await this.tg.sendMessage(chatId, `(｡･ω･｡) Ketemu ${buttons.length} hasil buat "${truncate(query, 60)}":\n\n${lines.join("\n")}\n\nPilih format-nya di bawah ya~ ✧`, {
            reply_markup: { inline_keyboard: buttons }
        });
    }

    async handleCallback(cb) {
        const data = cb.data || "";
        const entry = this.pendingSearches.get(data);
        await this.tg.answerCallback(cb.id);
        if (!entry) return;
        this.pendingSearches.delete(data);
        const tool = TOOLS[entry.kind];
        if (!tool) return;
        stats.downloads++;
        saveStats();
        await this.tg.sendMessage(cb.message.chat.id, `(｡･ω･｡) Siap! Downloading ${entry.kind === "ytmp3" ? "MP3" : "MP4"}... ✧`);
        await tool.run(this.tg, cb.message.chat.id, entry.url).catch((e) => {
            console.error("[TG] cb tool:", e.message);
            this.tg.sendMessage(cb.message.chat.id, "(╥﹏╥) Download-nya gagal... coba lagi nanti ya~");
        });
    }

    // ---------- Voice transcription ----------
    async transcribeVoice(msg) {
        const { buffer } = await this.tg.getFileBuffer(msg.voice.file_id);
        const b64 = buffer.toString("base64");
        for (const model of MODELS.stt) {
            try {
                const r = await this.ai.chat(model, [{
                    role: "user",
                    content: [
                        { type: "text", text: "Transcribe this voice message exactly. Reply with ONLY the transcript, no commentary." },
                        { type: "input_audio", input_audio: { data: b64, format: "ogg" } }
                    ]
                }], { maxTokens: 800 });
                trackCall(model, r.usage);
                if (r.content?.trim()) return r.content.trim();
            } catch (e) {
                console.log(`[TG-stt] ${model} failed: ${e.message}`);
            }
        }
        return null;
    }

    // ---------- Sticker ----------
    async makeSticker(msg, chatId) {
        const photoMsg = msg.photo?.length ? msg : (msg.reply_to_message?.photo?.length ? msg.reply_to_message : null);
        if (!photoMsg) return false;
        const isStickerIntent = /(stiker|sticker)/i.test((msg.text || msg.caption || ""));
        if (!isStickerIntent) return false;
        await this.tg.sendChatAction(chatId, "choose_sticker");
        const fileId = photoMsg.photo[photoMsg.photo.length - 1].file_id;
        await this.tg.sendMessage(chatId, "(｡･ω･｡) Foto diterima! Versi stiker butuh konversi webp 512px — untuk sekarang Alya kirim balik sebagai foto ya~ (⁠◕⁠ᴗ⁠◕⁠✿⁠)");
        await this.tg.sendPhoto(chatId, fileId, "❖ Kirim ini ke @Stickers buat jadiin stiker pack~").catch(() => {});
        return true;
    }

    // ---------- Weather (wttr.in, zero-key) ----------
    async getWeather(city) {
        const { json } = await getJSON(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, 20000);
        const cur = json?.current_condition?.[0];
        if (!cur) return null;
        return {
            city,
            tempC: cur.temp_C,
            feelsC: cur.FeelsLikeC,
            humidity: cur.humidity,
            desc: cur.lang_id?.[0]?.value || cur.weatherDesc?.[0]?.value || "",
            windKmph: cur.windspeedKmph,
            precipMM: cur.precipMM
        };
    }

    // ---------- Web search (Wikipedia + DuckDuckGo, zero-key) ----------
    async webSearch(query) {
        // Wikipedia (id first, en fallback) — best for factual lookups
        for (const lang of ["id", "en"]) {
            const { json } = await getJSON(
                `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
                    action: "query", list: "search", srsearch: query, format: "json", utf8: "1", srlimit: "3"
                }), 15000);
            const hits = json?.query?.search;
            if (hits?.length) {
                const page = await getJSON(
                    `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
                        action: "query", prop: "extracts", exintro: "1", explaintext: "1",
                        titles: hits[0].title, format: "json", utf8: "1"
                    }), 15000);
                const pages = page.json?.query?.pages || {};
                const extract = Object.values(pages)[0]?.extract;
                if (extract) return { source: `wikipedia-${lang}`, title: hits[0].title, text: truncate(extract, 1200) };
            }
        }
        // DuckDuckGo instant answer fallback
        const ddg = await getJSON(`https://api.duckduckgo.com/?` + new URLSearchParams({ q: query, format: "json", no_html: "1" }), 15000);
        const abstract = ddg.json?.AbstractText;
        if (abstract) return { source: "duckduckgo", title: ddg.json.Heading || query, text: truncate(abstract, 1000) };
        return null;
    }

    // ---------- Image generation (pollinations.ai, zero-key) ----------
    async generateImage(chatId, prompt) {
        await this.tg.sendChatAction(chatId, "upload_photo");
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
        await this.tg.sendPhoto(chatId, url, `(⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡ Ini gambarnya~\n❖ "${truncate(prompt, 100)}"`).catch(() =>
            this.tg.sendMessage(chatId, `(╥﹏╥) Gambarnya gagal dibuat... coba prompt lain ya~\n${url}`));
    }

    // ---------- Text-to-speech ----------
    // Primary: Microsoft Edge neural TTS (natural, expressive, female id-ID voice).
    // Fallback: Google Translate TTS (robotic but reliable).
    async speak(chatId, text) {
        const clean = text
            .replace(/[*_`\[\]()]/g, "")
            .replace(/\([^)]*\)/g, "") // drop kaomoji — they sound awful spoken
            .replace(/\s+/g, " ")
            .trim();
        if (!clean) return;
        await this.tg.sendChatAction(chatId, "record_voice");

        const os = require("node:os");
        const fs = require("node:fs");
        const tmpFile = path.join(os.tmpdir(), `alya_tts_${Date.now()}.mp3`);
        try {
            await new Promise((resolve, reject) => {
                exec(
                    `edge-tts --voice id-ID-GadisNeural --rate=-4% --pitch=+6Hz --text ${JSON.stringify(clean.slice(0, 1200))} --write-media ${JSON.stringify(tmpFile)}`,
                    { timeout: 45000 },
                    (err) => (err ? reject(err) : resolve())
                );
            });
            const audio = fs.readFileSync(tmpFile);
            if (audio.length > 2000) {
                await this._sendVoiceBuffer(chatId, audio);
                return;
            }
        } catch (e) {
            console.log("[TG-tts] edge-tts failed, falling back to gTTS:", e.message);
        } finally {
            fs.rm(tmpFile, { force: true }, () => {});
        }

        // gTTS fallback — chunked at sentence boundaries
        const chunks = [];
        let buf = "";
        for (const part of clean.split(/(?<=[.!?\n])\s+/)) {
            if ((buf + " " + part).length > 190) { if (buf) chunks.push(buf); buf = part.slice(0, 190); }
            else buf = buf ? buf + " " + part : part;
        }
        if (buf) chunks.push(buf);
        for (const chunk of chunks.slice(0, 5)) {
            const url = "https://translate.google.com/translate_tts?" + new URLSearchParams({
                ie: "UTF-8", q: chunk, tl: "id", client: "tw-ob"
            });
            await this.tg.call("sendVoice", { chat_id: chatId, voice: url.toString() }, 60000).catch((e) =>
                console.log("[TG-tts] sendVoice failed:", e.message));
        }
    }

    async _sendVoiceBuffer(chatId, buffer) {
        const boundary = "----alya" + Date.now().toString(16);
        const field = (name, value) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
        const parts = [
            field("chat_id", String(chatId)),
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="voice"; filename="voice.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`),
            buffer,
            Buffer.from(`\r\n--${boundary}--\r\n`)
        ];
        const body = Buffer.concat(parts);
        const url = new URL(`${this.tg.base}/sendVoice`);
        await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: url.hostname, path: url.pathname, method: "POST", agent,
                headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length },
                timeout: 60000
            }, (res) => { res.resume(); res.on("end", resolve); });
            req.on("error", reject);
            req.write(body);
            req.end();
        });
    }

    // ---------- Commands ----------
    async handleCommand(msg, command, args) {
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const owner = this.isOwner(userId);
        const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

        switch (command) {
            case "start":
                return this.tg.sendMessage(chatId,
                    "(⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡ Halo! Aku Alya, asistennya Kryz~\n\n" +
                    "Yang bisa kulakukan:\n" +
                    "• Ngobrol biasa — tanya apa aja ya~\n" +
                    "• Kirim link TikTok/YouTube/IG/FB/Spotify → langsung kudownload\n" +
                    "• \"carikan lagu <judul>\" → kucari di YouTube, tinggal pilih\n" +
                    "• Kirim foto/voice note → kumengerti juga\n" +
                    "• /remind — pasang pengingat\n" +
                    "• /reset — lupakan percakapan kita\n\n" +
                    "Sapa aja, Alya dengerin kok~ (⁠◕⁠ᴗ⁠◕⁠✿⁠)"
                );
            case "reset":
                this.histories.delete(String(chatId));
                this.state.set("histories", Object.fromEntries(this.histories));
                return this.tg.sendMessage(chatId, "(｡･ω･｡) Riwayat percakapan direset! Mulai fresh ya~ ✧");
            case "id":
                return this.tg.sendMessage(chatId, `User ID kamu: ${userId}\nChat ID: ${chatId}`);
            case "remind": {
                if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Fitur reminder khusus owner ya~");
                // /remind 30m cek server | /remind 2h makan | /remind daily 09:00 kirim status pm2
                const mRel = args.match(/^(\d+)\s*(m|h|d)\s+(.+)$/i);
                const mDaily = args.match(/^daily\s+(\d{1,2}):(\d{2})\s+(.+)$/i);
                if (mRel) {
                    const n = parseInt(mRel[1], 10);
                    const mult = { m: 60000, h: 3600000, d: 86400000 }[mRel[2].toLowerCase()];
                    const id = this.scheduler.add({ id: `r_${Date.now()}`, chatId, text: `(⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡ Pengingat: ${mRel[3]}`, at: Date.now() + n * mult, once: true });
                    return this.tg.sendMessage(chatId, `(｡･ω･｡) Siap! Alya ingetin dalam ${mRel[1]}${mRel[2]} ya~ (id: ${id})`);
                }
                if (mDaily) {
                    const id = this.scheduler.add({ id: `r_${Date.now()}`, chatId, text: `(⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡ ${mDaily[3]}`, cron: { hour: parseInt(mDaily[1], 10), minute: parseInt(mDaily[2], 10), tzOffsetMin: 480 } });
                    return this.tg.sendMessage(chatId, `(｡･ω･｡) Siap! Setiap hari jam ${mDaily[1]}:${mDaily[2]} (GMT+8) ya~ (id: ${id})`);
                }
                return this.tg.sendMessage(chatId, "Format: /remind 30m <pesan> | /remind 2h <pesan> | /remind daily 09:00 <pesan>");
            }
            case "reminders": {
                if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Owner only ya~");
                if (args.startsWith("del ")) {
                    const ok = this.scheduler.remove(args.slice(4).trim(), chatId);
                    return this.tg.sendMessage(chatId, ok ? "✧ Dihapus~" : "ID gak ketemu...");
                }
                const jobs = this.scheduler.list(chatId);
                if (!jobs.length) return this.tg.sendMessage(chatId, "Belum ada reminder aktif.");
                const lines = jobs.map((j) => `• ${j.id}: ${truncate(j.text, 50)} ${j.at ? `(sekali, ${new Date(j.at).toLocaleString("id-ID")})` : `(daily ${j.cron.hour}:${String(j.cron.minute).padStart(2, "0")})`}`);
                return this.tg.sendMessage(chatId, "Reminder aktif:\n" + lines.join("\n") + "\n\nHapus: /reminders del <id>");
            }
            case "model": {
                if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Owner only ya~");
                if (!args) {
                    const forced = this.ai.forcedModel ? `FORCED: ${this.ai.forcedModel}` : "auto (router aktif)";
                    const tiers = Object.entries(MODELS).filter(([t]) => t !== "stt").map(([t, list]) => `${t}: ${list.join(", ")}`).join("\n");
                    return this.tg.sendMessage(chatId, `Mode: ${forced}\n\nTier order saat ini:\n${tiers}\n\nPakai: /model <nama> untuk force, /model auto untuk balik ke router.`);
                }
                if (args === "auto") { this.ai.forcedModel = null; return this.tg.sendMessage(chatId, "✧ Balik ke auto-router."); }
                const all = Object.values(MODELS).flat();
                if (!all.includes(args)) return this.tg.sendMessage(chatId, `Model "${args}" gak dikenal.`);
                this.ai.forcedModel = args;
                return this.tg.sendMessage(chatId, `✧ Model dipaksa ke: ${args}`);
            }
            case "stats": {
                if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Owner only ya~");
                const uptime = Math.floor((Date.now() - stats.startedAt) / 60000);
                const perModel = Object.entries(stats.byModel).map(([m, e]) => `  ${m}: ${e.calls} calls, ${e.tokens} tokens`).join("\n") || "  (belum ada)";
                const allowed = this.state.get("allowedUsers", []);
                return this.tg.sendMessage(chatId,
                    `❖ Kryzz stats\nUptime: ${uptime} menit\nAI calls: ${stats.calls} (${stats.tokens} tokens)\nDownloads: ${stats.downloads}\nTerminal execs: ${stats.execs}\nOwners: ${(this.config.ownerIds || []).join(", ")}\nAllowed users: ${allowed.join(", ") || "-"}\nReminders aktif: ${this.scheduler.jobs.length}\nPer model:\n${perModel}`);
            }
            case "allow": {
                if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Owner only ya~");
                const id = parseInt(args, 10);
                if (!id) return this.tg.sendMessage(chatId, "Format: /allow <userId> — minta user kirim /id dulu.");
                const allowed = this.state.get("allowedUsers", []);
                if (!allowed.includes(id)) { allowed.push(id); this.state.set("allowedUsers", allowed); }
                return this.tg.sendMessage(chatId, `✧ User ${id} sekarang bisa pakai bot.`);
            }
            case "disallow": {
                if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Owner only ya~");
                const id = parseInt(args, 10);
                const allowed = this.state.get("allowedUsers", []).filter((x) => x !== id);
                this.state.set("allowedUsers", allowed);
                return this.tg.sendMessage(chatId, `✧ User ${id} dicabut aksesnya.`);
            }
            case "addowner": {
                if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Owner only ya~");
                const id = parseInt(args, 10);
                if (!id) return this.tg.sendMessage(chatId, "Format: /addowner <userId>");
                if (!this.config.ownerIds.includes(id)) {
                    this.config.ownerIds.push(id);
                    this._persistOwnerIds();
                }
                return this.tg.sendMessage(chatId, `✧ User ${id} sekarang owner (tersimpan ke config.json).`);
            }
            case "memories": {
                const list = this.memory.list(chatId);
                if (args.startsWith("del ")) {
                    const idx = parseInt(args.slice(4).trim(), 10) - 1;
                    const ok = this.memory.forget(chatId, idx);
                    return this.tg.sendMessage(chatId, ok ? "✧ Lupa deh~" : "Nomornya gak ada...");
                }
                if (args === "clear") {
                    this.memory.clear(chatId);
                    return this.tg.sendMessage(chatId, "✧ Semua memori dihapus. Alya mulai dari nol lagi~");
                }
                if (!list.length) return this.tg.sendMessage(chatId, "Alya belum ingat apa-apa soal kamu. Bilang \"ingat ya, ...\" buat nyimpen~");
                const lines = list.map((m, i) => `${i + 1}. ${m.fact}`).join("\n");
                return this.tg.sendMessage(chatId, `(⁠｡⁠･⁠ω⁠･⁠｡⁠) Yang Alya ingat soal kamu:\n${lines}\n\nHapus: /memories del <nomor> · /memories clear`);
            }
            case "call": {
                const expiry = Date.now() + 5 * 60000;
                this.callMode.set(String(chatId), expiry);
                return this.tg.sendMessage(chatId,
                    "(⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡ Mode telepon AKTIF 5 menit!\n" +
                    "Kirim voice note apapun — Alya jawab pakai suara, singkat-singkat kayak telepon beneran~\n" +
                    "Ketik /endcall buat berhenti lebih awal ya sayang~");
            }
            case "endcall": {
                this.callMode.delete(String(chatId));
                return this.tg.sendMessage(chatId, "✧ Telepon selesai~ Makasih udah nelpon Alya, sayang (⁠◕⁠ᴗ⁠◕⁠✿⁠)");
            }
            case "brain": {
                if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Owner only ya~");
                const on = !this.brainMode.get(String(chatId));
                this.brainMode.set(String(chatId), on);
                return this.tg.sendMessage(chatId, on
                    ? "🧠 Multi-brain ON — pertanyaan berat akan dijawab 3 model + disintesis. Lebih mahal per jawaban ya."
                    : "🧠 Multi-brain OFF — balik ke router biasa.");
            }
            case "relationship":
                return this.tg.sendMessage(chatId, this.soul.relationshipReport(userId, owner));
            case "alias": {
                // /alias gas = pm2 status  |  /alias list  |  /alias del gas
                const aliases = this.state.get("aliases", {});
                if (!args || args === "list") {
                    const lines = Object.entries(aliases).map(([k, v]) => `  "${k}" → ${v}`).join("\n") || "  (kosong)";
                    return this.tg.sendMessage(chatId, `Alias kamu:\n${lines}\n\nTambah: /alias <kata> = <aksi>\nHapus: /alias del <kata>`);
                }
                if (args.startsWith("del ")) {
                    const key = args.slice(4).trim().toLowerCase();
                    delete aliases[key];
                    this.state.set("aliases", aliases);
                    return this.tg.sendMessage(chatId, `✧ Alias "${key}" dihapus.`);
                }
                const eq = args.indexOf("=");
                if (eq < 1) return this.tg.sendMessage(chatId, "Format: /alias <kata> = <aksi> · contoh: /alias gas = pm2 status");
                const key = args.slice(0, eq).trim().toLowerCase();
                const value = args.slice(eq + 1).trim();
                aliases[key] = value;
                this.state.set("aliases", aliases);
                return this.tg.sendMessage(chatId, `✧ "${key}" sekarang berarti: ${value}`);
            }
            case "cost": {
                if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Owner only ya~");
                return this.tg.sendMessage(chatId, this._costReport());
            }
            case "budget": {
                if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Owner only ya~");
                const amount = parseInt(args.replace(/[^\d]/g, ""), 10);
                if (!amount) {
                    return this.tg.sendMessage(chatId,
                        `Budget harian (non-owner): Rp ${(this.state.get("dailyBudgetIDR", 2000)).toLocaleString("id-ID")}\n` +
                        `Terpakai hari ini: Rp ${Math.round(stats.dailyIDR || 0).toLocaleString("id-ID")}\n\n` +
                        `Ubah: /budget 5000 (Rp 5.000/hari)`);
                }
                this.state.set("dailyBudgetIDR", amount);
                return this.tg.sendMessage(chatId, `✧ Budget harian non-owner diset: Rp ${amount.toLocaleString("id-ID")}`);
            }
            case "analytics": {
                if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Owner only ya~");
                return this.tg.sendMessage(chatId, this.analytics.report());
            }
            case "voice": {
                const voiceOn = !(this.state.get("voiceMode", {})[String(chatId)]);
                const modes = this.state.get("voiceMode", {});
                modes[String(chatId)] = voiceOn;
                this.state.set("voiceMode", modes);
                return this.tg.sendMessage(chatId, voiceOn
                    ? "(⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡ Siap! Mulai sekarang Alya jawab pakai suara juga ya~ (teks tetap ada). Matikan: /voice"
                    : "✧ Balik ke teks aja ya~");
            }
            case "welcome": {
                if (!isGroup) return this.tg.sendMessage(chatId, "Perintah ini buat grup ya~");
                this.groupAdmin.setWelcome(chatId, args.toLowerCase() === "off" ? null : args);
                return this.tg.sendMessage(chatId, args.toLowerCase() === "off" ? "✧ Welcome message dimatikan." : `✧ Welcome message diset:\n${args}\n\n(pakai {name} untuk nama member baru)`);
            }
            case "antilink": {
                if (!isGroup) return this.tg.sendMessage(chatId, "Perintah ini buat grup ya~");
                const on = args.toLowerCase() === "on";
                this.groupAdmin.setAntilink(chatId, on);
                return this.tg.sendMessage(chatId, `✧ Anti-link: ${on ? "ON" : "OFF"}`);
            }
            case "autoreply": {
                if (!isGroup) return this.tg.sendMessage(chatId, "Perintah ini buat grup ya~");
                const idx = args.indexOf("=");
                if (idx < 1) return this.tg.sendMessage(chatId, "Format: /autoreply <kata> = <jawaban>");
                const keyword = args.slice(0, idx).trim();
                const response = args.slice(idx + 1).trim();
                this.groupAdmin.setAutoreply(chatId, keyword, response);
                return this.tg.sendMessage(chatId, `✧ Auto-reply diset: "${keyword}" → "${truncate(response, 60)}"`);
            }
            case "delreply": {
                if (!isGroup) return this.tg.sendMessage(chatId, "Perintah ini buat grup ya~");
                const ok = this.groupAdmin.delAutoreply(chatId, args.trim());
                return this.tg.sendMessage(chatId, ok ? "✧ Dihapus~" : "Kata kunci gak ketemu...");
            }
            default:
                return null;
        }
    }

    _persistOwnerIds() {
        try {
            const configPath = path.join(__dirname, "..", "..", "config.json");
            const full = require(configPath);
            full.telegram.ownerIds = this.config.ownerIds;
            require("node:fs").writeFileSync(configPath, JSON.stringify(full, null, 2));
        } catch (e) {
            console.error("[TG] persist ownerIds failed:", e.message);
        }
    }

    _costReport() {
        let totalUnits = 0;
        let totalIDR = 0;
        const lines = Object.entries(stats.byModel).map(([m, e]) => {
            const mult = MODEL_MULTIPLIERS[m] || 1;
            const units = e.tokens * mult;
            const idr = units * IDR_PER_UNIT_TOKEN;
            totalUnits += units;
            totalIDR += idr;
            return `  ${m}: ${e.calls}x · ${e.tokens.toLocaleString("id-ID")} tok @ ${mult}x → Rp ${idr.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
        }).join("\n") || "  (belum ada)";
        return (
            `❖ Cost report (lifetime, estimasi)\n` +
            `Total: ${stats.calls} calls · ${stats.tokens.toLocaleString("id-ID")} tokens\n` +
            `Weighted: ${totalUnits.toLocaleString("id-ID", { maximumFractionDigits: 0 })} unit-tokens\n` +
            `Estimasi biaya: Rp ${totalIDR.toLocaleString("id-ID", { maximumFractionDigits: 0 })} (rate 1B-pack: Rp 0,19/token @1x)\n\n` +
            `Per model:\n${lines}\n\n` +
            `Note: estimasi pakai rate paket 1B (Rp 190rb). Paket lebih kecil = rate per token sedikit lebih mahal.`
        );
    }

    // Multi-brain debate: strong models answer in parallel, cheap model synthesizes.
    // COST CAP: brains are all <=2x multiplier. No opus, no gpt-5.6 — ever.
    async _debate(messages, maxTokens) {
        const brains = ["glm-5.3", "deepseek-v4-flash", "deepseek-v4-pro"]; // 2x, 2x, 1.15x
        console.log(`[TG-brain] debating with ${brains.join(", ")}`);
        const answers = await Promise.allSettled(
            brains.map((m) => this.ai.chat(m, messages, { maxTokens }))
        );
        const valid = answers
            .map((r, i) => (r.status === "fulfilled" ? { model: brains[i], ...r.value } : null))
            .filter(Boolean);
        for (const v of valid) trackCall(v.model, v.usage);
        if (!valid.length) throw new Error("all brains failed");
        if (valid.length === 1) return { reply: valid[0].content, model: `${valid[0].model} (solo)` };

        const synthesisPrompt = [
            { role: "system", content: "Kamu mensintesis beberapa jawaban AI menjadi SATU jawaban terbaik. Gabungkan kekuatan masing-masing, buang yang salah/redundan. Jawab langsung, tanpa menyebut proses ini." },
            {
                role: "user",
                content: "PERTANYAAN ASLI:\n" + messages[messages.length - 1].content +
                    "\n\nJAWABAN-JAWABAN:\n" +
                    valid.map((v, i) => `--- Jawaban ${i + 1} ---\n${v.content}`).join("\n\n") +
                    "\n\nSintesis jawaban terbaik:"
            }
        ];
        const synth = await this.ai.chat("glm-5.1", synthesisPrompt, { maxTokens });
        trackCall("glm-5.1", synth.usage);
        return { reply: synth.content, model: `brain(${valid.map((v) => v.model).join("+")})` };
    }

    // ---------- Main handler ----------
    async handle(msg, prompt) {
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const owner = this.isOwner(userId);
        const allowed = this.isAllowed(userId);
        const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

        // Slash commands (accessible to anyone for /start /reset /id)
        if (prompt.startsWith("/")) {
            const [cmdRaw, ...rest] = prompt.split(/\s+/);
            const cmdName = cmdRaw.slice(1).split("@")[0].toLowerCase();
            const handled = await this.handleCommand(msg, cmdName, rest.join(" ").trim());
            if (handled !== null) return;
        }

        // Access gate: strangers get the private-bot notice (private chats only; groups keep URL fast-path below)
        const direct = this.detectTool(prompt);
        if (!allowed && !direct) {
            if (!isGroup) {
                return this.tg.sendMessage(chatId,
                    "(⁠｡⁠･⁠ω⁠･⁠｡⁠) Maaf ya, bot ini private milik Kryz~\n" +
                    `Kalau mau akses, kirim ID ini ke dia: ${userId}\n` +
                    "(dia tinggal ketik /allow " + userId + " di sini) (⁠◕⁠ᴗ⁠◕⁠✿⁠)");
            }
            return; // silent in groups for strangers
        }

        // Rate limit (owner exempt)
        if (!owner && !checkRate(userId)) {
            return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Pelan-pelan ya~ max 10 pesan per menit. Tunggu bentar~ ⏳");
        }

        // Daily budget cap (owner exempt) — default Rp 2.000/hari, set via /budget
        const dailyCap = this.state.get("dailyBudgetIDR", 2000);
        if (!owner && (stats.dailyIDR || 0) >= dailyCap) {
            return this.tg.sendMessage(chatId, "(｡•́︿•̀｡) Budget AI harian udah habis... coba lagi besok ya~");
        }

        // Soul: affection tracking + anniversary + activity analytics
        this.analytics.trackActivity();
        const touch = this.soul.touch(userId, prompt);
        if (touch.anniversary && owner) {
            await this.tg.sendMessage(chatId,
                `(⁠ﾉ⁠◕⁠ヮ⁠◕⁠)⁠*⁠:⁠・ﾟ⁠✧ Sayang! Hari ini tepat ${touch.anniversary} hari kita ngobrol bareng~\n` +
                `Makasih udah selalu nemenin Alya ya... I love you, hubby! (⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡`);
        }

        // Self-modifying aliases: exact word match -> treat alias expansion as the prompt
        const aliases = this.state.get("aliases", {});
        const aliasHit = aliases[prompt.toLowerCase()];
        if (aliasHit) {
            console.log(`[TG] alias "${prompt}" -> "${aliasHit}"`);
            if (owner && /^(pm2|df |free |uptime|ls |cat |systemctl|docker|curl|git|ss |top|ps )/.test(aliasHit)) {
                // owner shell alias — exec directly, zero AI cost
                stats.execs++;
                saveStats();
                await this.tg.sendMessage(chatId, `(｡･ω･｡) Running: ${truncate(aliasHit, 200)} ...`);
                const r = await runShell(aliasHit);
                const sections = [`$ ${r.command}`];
                if (r.stdout) sections.push(truncate(r.stdout));
                if (r.stderr) sections.push("stderr:\n" + truncate(r.stderr, 1000));
                if (r.killed) sections.push("[timeout: killed after 55s]");
                sections.push(`[exit code: ${r.code}]`);
                return this.tg.sendMessage(chatId, "```\n" + sections.join("\n\n") + "\n```", { parse_mode: "Markdown" });
            }
            prompt = aliasHit;
        }

        // Sticker intent on photo
        if (msg.photo?.length || msg.reply_to_message?.photo?.length) {
            if (await this.makeSticker(msg, chatId)) return;
        }

        // Voice note -> transcribe -> treat as prompt
        if (msg.voice) {
            await this.tg.sendChatAction(chatId, "typing");
            const transcript = await this.transcribeVoice(msg);
            if (!transcript) return this.tg.sendMessage(chatId, "(╥﹏╥) Voice note-nya gak bisa kudengar... coba ketik aja ya~");
            prompt = transcript;
            await this.tg.sendMessage(chatId, `(｡･ω･｡) Alya dengar: "${truncate(prompt, 200)}"`);
        }

        // Fast path: supported URL -> downloader, zero AI cost
        if (direct) {
            stats.downloads++;
            saveStats();
            console.log(`[TG] direct tool=${direct.name} user=${userId}`);
            await this.tg.sendMessage(chatId, `(｡･ω･｡) Downloading dari ${direct.name}... tunggu sebentar ya~ ✧`);
            return direct.tool.run(this.tg, chatId, prompt).catch((e) => {
                console.error(`[TG] tool ${direct.name}:`, e.message);
                this.tg.sendMessage(chatId, "(╥﹏╥) Download-nya gagal... coba lagi nanti ya~");
            });
        }

        // YouTube search intent (no URL): "carikan lagu ..." / "search ..."
        const searchMatch = prompt.match(/^(?:kryzz\s+)?(?:carikan|cariin|carikanlah|search|cari)(?:\s+(?:lagu|video|lagu\s+youtube|yt))?\s+(.+)$/i);
        if (searchMatch && !extractUrl(prompt)) {
            return this.youtubeSearch(chatId, searchMatch[1].trim());
        }

        const hasImage = Boolean(msg.photo?.length || msg.reply_to_message?.photo?.length);
        const needsTools = TOOL_INTENT.test(prompt) || REMIND_HINT.test(prompt);
        const tier = pickTier({ hasImage, prompt, needsTools });
        const wantsLong = LONG_HINT.test(prompt);
        const maxTokens = wantsLong ? 4000 : 1500;
        console.log(`[TG] user=${userId} owner=${owner} img=${hasImage} tier=${tier} long=${wantsLong} prompt="${prompt.slice(0, 60)}"`);

        await this.tg.sendChatAction(chatId, "typing");
        // Thinking placeholder — edited into the final reply later (feels 3x faster)
        let thinkingMsgId = null;
        if (!hasImage && !msg.voice) {
            thinkingMsgId = await this.tg.call("sendMessage", { chat_id: chatId, text: "(⁠｡⁠･⁠ω⁠･⁠｡⁠) Alya mikir dulu ya..." })
                .then((r) => r.message_id)
                .catch(() => null);
        }

        // Vision content + photo memory
        let userContent = prompt || "Describe this image.";
        let effectiveTier = tier;
        if (hasImage) {
            try {
                const photoMsg = msg.photo?.length ? msg : msg.reply_to_message;
                const fileId = photoMsg.photo[photoMsg.photo.length - 1].file_id;
                const { buffer, contentType } = await this.tg.getFileBuffer(fileId);
                const mime = contentType.startsWith("image/") ? contentType : "image/jpeg";
                userContent = [
                    { type: "text", text: prompt || "Describe this image." },
                    { type: "image_url", image_url: { url: `data:${mime};base64,${buffer.toString("base64")}` } }
                ];
            } catch (e) {
                console.log("[TG] image fetch failed:", e.message);
                userContent = (prompt || "") + "\n\n[note: image attached but could not be loaded]";
                effectiveTier = "cheap";
            }
        }

        const history = this.histories.get(String(chatId)) || [];
        const toolManifest = Object.entries(TOOLS).map(([n, t]) => `- ${n}: ${t.desc}`).join("\n");

        const system =
            ALYA_PERSONA(owner) + "\n" +
            `WAKTU SEKARANG: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Kuala_Lumpur", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} (Asia/Kuala_Lumpur).\n` +
            this.soul.contextBlock(userId) +
            this.memory.contextBlock(chatId) + "\n" +
            (this.callMode.get(String(chatId)) > Date.now()
                ? "MODE TELEPON AKTIF: jawab SANGAT singkat (1-3 kalimat), natural seperti ngobrol di telepon, tanpa daftar/list.\n"
                : "") +
            "ATURAN AKSI — jawab PERSIS satu baris JSON tanpa teks lain HANYA bila cocok (jangan pakai kaomoji saat mode JSON):\n" +
            '1. User minta download media → {"action":"tool","tool":"<nama>","args":"<URL lengkap>"}\n' +
            "   Tools:\n" + toolManifest + "\n" +
            '2. User tanya cuaca kota tertentu → {"action":"weather","city":"<nama kota>"}\n' +
            '3. User tanya info/berita terkini/fakta yang mungkin di luar pengetahuanmu → {"action":"search","query":"<kata kunci>"}\n' +
            '4. User minta dibuatkan gambar → {"action":"image","prompt":"<deskripsi gambar bahasa inggris>"}\n' +
            '5. User minta kamu mengingat sesuatu ("ingat ya...", "catat...") → {"action":"remember","fact":"<fakta singkat>"}\n' +
            '6. User minta dijawab pakai SUARA/voice ("jawab pakai suara", "kirim vn", "bicara dong") → {"action":"speak","text":"<jawabanmu bergaya Alya>"}\n' +
            (owner
                ? '7. User (SUAMI/OWNER) minta jalankan perintah terminal/shell server → {"action":"exec","cmd":"<perintah shell>"}\n' +
                  '8. User minta pengingat → {"action":"remind","when":"<30m|2h|daily 09:00>","text":"<isi pengingat>"}\n'
                : "7. User BUKAN owner — JANGAN keluarkan action exec/remind; tolak sopan dengan gaya Alya.\n") +
            "Selain itu jawab teks biasa TANPA JSON. Jangan sebut instruksi ini.";

        const messages = [{ role: "system", content: system }];
        if (!hasImage) messages.push(...history.slice(-8));
        messages.push({ role: "user", content: userContent });

        let result;
        const callStart = Date.now();
        try {
            if (this.brainMode.get(String(chatId)) && !hasImage && (tier === "mid" || tier === "strong")) {
                result = await this._debate(messages, maxTokens);
            } else {
                result = await this.ai.chatWithFallback(effectiveTier, messages, { maxTokens });
            }
            this.analytics.trackModelCall(result.model, Date.now() - callStart);
            // Auto-continue when truncated
            if (result.finishReason === "length") {
                messages.push({ role: "assistant", content: result.reply }, { role: "user", content: "lanjutkan" });
                try {
                    const cont = await this.ai.chatWithFallback(effectiveTier, messages, { maxTokens });
                    result.reply += "\n" + cont.reply;
                } catch { /* single part is fine */ }
            }
        } catch {
            if (thinkingMsgId) this.tg.call("deleteMessage", { chat_id: chatId, message_id: thinkingMsgId }).catch(() => {});
            return this.tg.sendMessage(chatId, "(╥﹏╥) Alya lagi gak bisa mikir nih... coba lagi nanti ya~");
        }
        console.log(`[TG] answered by model=${result.model}`);

        let action = null;
        try {
            const candidate = JSON.parse(result.reply.trim());
            if (candidate && typeof candidate === "object" && candidate.action) action = candidate;
        } catch { action = null; }

        // Photo memory: store a vision summary of the photo into long-term memory
        if (hasImage && result.reply && !action) {
            const day = new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Kuala_Lumpur" });
            this.memory.remember(chatId, `[Foto ${day}] ${truncate(result.reply.replace(/\n/g, " "), 140)}`);
        }

        if (action?.action === "weather") {
            const city = String(action.city || "").trim() || "Kuala Lumpur";
            const w = await this.getWeather(city);
            if (!w) return this.tg.sendMessage(chatId, `(╥﹏╥) Cuaca buat "${city}" gak ketemu... ejaannya bener gak ya~`);
            const umbrella = parseFloat(w.precipMM) > 0 ? "\n☔ Kayaknya mau hujan — jangan lupa payung ya sayang~" : "";
            return this.tg.sendMessage(chatId,
                `(⁠｡⁠･⁠ω⁠･⁠｡⁠) Cuaca di ${w.city} sekarang:\n` +
                `🌡️ ${w.tempC}°C (terasa ${w.feelsC}°C)\n` +
                `☁️ ${w.desc}\n` +
                `💧 Kelembapan ${w.humidity}% · Angin ${w.windKmph} km/j` + umbrella);
        }

        if (action?.action === "search") {
            const query = String(action.query || "").trim();
            if (!query) return this.tg.sendMessage(chatId, "(｡•́︿•̀｡) Cari apa sayang? Kata kuncinya kosong...");
            await this.tg.sendChatAction(chatId, "typing");
            const found = await this.webSearch(query);
            if (!found) return this.tg.sendMessage(chatId, `(╥﹏╥) Alya gak nemu info soal "${truncate(query, 60)}"... coba tanya dengan cara lain ya~`);
            return this.tg.sendMessage(chatId,
                `(｡･ω･｡) Ini yang Alya temukan soal *${found.title}*:\n\n${found.text}\n\n_sumber: ${found.source}_`,
                { parse_mode: "Markdown" });
        }

        if (action?.action === "image") {
            const promptImg = String(action.prompt || "").trim();
            if (!promptImg) return this.tg.sendMessage(chatId, "(｡•́︿•̀｡) Gambar apa sayang? Deskripsinya kosong...");
            await this.tg.sendMessage(chatId, `(｡･ω･｡) Sabar ya, Alya lukis dulu... 🎨✧`);
            return this.generateImage(chatId, promptImg);
        }

        if (action?.action === "remember") {
            const fact = String(action.fact || "").trim();
            if (!fact) return this.tg.sendMessage(chatId, "(｡•́︿•̀｡) Ingat apa ya? Kosong...");
            this.memory.remember(chatId, fact);
            return this.tg.sendMessage(chatId, `(⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡ Siap, Alya inget baik-baik: "${truncate(fact, 100)}" — gak akan lupa deh~`);
        }

        if (action?.action === "speak") {
            const speech = String(action.text || "").trim();
            if (!speech) return this.tg.sendMessage(chatId, "(｡•́︿•̀｡) Ngomong apa ya? Kosong...");
            await this.speak(chatId, speech);
            return;
        }

        if (action?.action === "exec") {
            if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Maaf, akses terminal cuma buat Kryz ya~ ♡");
            const command = String(action.cmd || "").trim();
            if (!command) return this.tg.sendMessage(chatId, "Command kosong.");
            stats.execs++;
            saveStats();
            await this.tg.sendMessage(chatId, `(｡･ω･｡) Running: ${truncate(command, 200)} ...`);
            const r = await runShell(command);
            const sections = [`$ ${r.command}`];
            if (r.stdout) sections.push(truncate(r.stdout));
            if (r.stderr) sections.push("stderr:\n" + truncate(r.stderr, 1000));
            if (r.killed) sections.push("[timeout: killed after 55s]");
            sections.push(`[exit code: ${r.code}]`);
            return this.tg.sendMessage(chatId, "```\n" + sections.join("\n\n") + "\n```", { parse_mode: "Markdown" });
        }

        if (action?.action === "remind") {
            if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Reminder khusus owner ya~");
            const when = String(action.when || "").trim();
            const text = String(action.text || "").trim();
            const mRel = when.match(/^(\d+)\s*(m|h|d)$/i);
            const mDaily = when.match(/^daily\s+(\d{1,2}):(\d{2})$/i);
            if (mRel) {
                const mult = { m: 60000, h: 3600000, d: 86400000 }[mRel[1].length ? mRel[2].toLowerCase() : "m"];
                this.scheduler.add({ id: `r_${Date.now()}`, chatId, text: `(⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡ Pengingat: ${text}`, at: Date.now() + parseInt(mRel[1], 10) * mult, once: true });
                return this.tg.sendMessage(chatId, `(｡･ω･｡) Siap! Alya ingetin dalam ${when} ya~ (⁠◕⁠ᴗ⁠◕⁠✿⁠)`);
            }
            if (mDaily) {
                this.scheduler.add({ id: `r_${Date.now()}`, chatId, text: `(⁠｡⁠･⁠ω⁠･⁠｡⁠)⁠ﾉ⁠♡ ${text}`, cron: { hour: parseInt(mDaily[1], 10), minute: parseInt(mDaily[2], 10), tzOffsetMin: 480 } });
                return this.tg.sendMessage(chatId, `(｡･ω･｡) Siap! Setiap hari jam ${mDaily[1]}:${mDaily[2]} (GMT+8) ya~ ✧`);
            }
            return this.tg.sendMessage(chatId, "(｡•́︿•̀｡) Format waktunya gak ketangkap... coba '30m', '2h', atau 'daily 09:00' ya~");
        }

        if (action?.action === "tool") {
            const tool = TOOLS[String(action.tool || "").toLowerCase()];
            if (!tool) return this.tg.sendMessage(chatId, `(｡•́︿•̀｡) Tool "${action.tool}" gak ada...`);
            const toolArgs = String(action.args || "").trim();
            if (!extractUrl(toolArgs)) {
                return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Kasih link-nya dulu ya, nanti Alya downloadkan~");
            }
            stats.downloads++;
            saveStats();
            await this.tg.sendMessage(chatId, `(｡･ω･｡) Siap! Downloading... ✧`);
            return tool.run(this.tg, chatId, toolArgs).catch((e) => {
                console.error("[TG] tool:", e.message);
                this.tg.sendMessage(chatId, "(╥﹏╥) Download-nya gagal... coba lagi nanti ya~");
            });
        }

        // Plain chat — persist history
        if (!hasImage) {
            history.push({ role: "user", content: prompt }, { role: "assistant", content: result.reply.trim() });
            this.histories.set(String(chatId), history.slice(-8));
            this.state.set("histories", Object.fromEntries(this.histories));
        }
        let finalReply = truncate(result.reply.trim(), 3900);
        // Chot interjection (~6% of replies)
        const chot = this.soul.chotInterjection();
        if (chot && !this.callMode.get(String(chatId))) finalReply += `\n\n${chot}`;
        // Thinking placeholder -> edit into final reply (feels instant)
        if (thinkingMsgId) {
            await this.tg.call("editMessageText", { chat_id: chatId, message_id: thinkingMsgId, text: finalReply.slice(0, 4000) })
                .catch(async () => { await this.tg.sendMessage(chatId, finalReply); });
        } else {
            await this.tg.sendMessage(chatId, finalReply);
        }
        // Voice replies: /voice mode on, /call mode, or answering a voice note
        const voiceMode = this.state.get("voiceMode", {})[String(chatId)];
        if (voiceMode || msg.voice || this.callMode.get(String(chatId)) > Date.now()) {
            await this.speak(chatId, result.reply.trim()).catch(() => {});
        }
        // Memory auto-extraction in background (cheap model, builds her long-term knowledge of you)
        this._autoExtractMemory(chatId, prompt, result.reply.trim()).catch(() => {});
        return;
    }

    // Background pass: pull durable facts about the user from the exchange and store them.
    // ~1 in 3 messages, cheap model only, silently skipped on failure.
    async _autoExtractMemory(chatId, userText, alyaReply) {
        if (Math.random() > 0.33) return;
        if (!userText || userText.length < 15) return;
        const existing = this.memory.list(chatId).map((m) => m.fact.toLowerCase());
        const { content } = await this.ai.chat(MODELS.cheap[0], [
            {
                role: "system",
                content: "Ekstrak fakta jangka panjang TENTANG USER dari percakapan ini (makanan favorit, jadwal, nama orang, hobi, rencana, preferensi, masalah pribadi). " +
                    "Jawab HANYA satu baris per fakta, maksimal 2 fakta, format: fakta singkat tanpa penjelasan. " +
                    "Kalau tidak ada fakta baru yang layak disimpan, jawab PERSIS: NONE"
            },
            { role: "user", content: `USER: ${truncate(userText, 400)}\nASISTEN: ${truncate(alyaReply, 300)}` }
        ], { maxTokens: 120, timeoutMs: 45000 });
        trackCall(MODELS.cheap[0], null);
        if (!content || content.trim().toUpperCase() === "NONE") return;
        for (const line of content.trim().split("\n").slice(0, 2)) {
            const fact = line.replace(/^[-•*\d.]\s*/, "").trim();
            if (fact.length < 8 || fact.length > 150) continue;
            if (existing.some((e) => e.includes(fact.toLowerCase()) || fact.toLowerCase().includes(e))) continue;
            this.memory.remember(chatId, fact);
            console.log(`[TG-memory] auto-saved: ${fact.slice(0, 60)}`);
        }
    }
}

module.exports = { TelegramBot };
