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

// ==================== MODEL ROUTER ====================
const MODELS = {
    cheap: ["glm-5.1", "hy3", "kimi-k2.7-code"],
    mid: ["deepseek-v4-pro", "glm-5.2", "deepseek-v4-mod"],
    strong: ["glm-5.3", "glm-5.3-flash"],
    vision: ["deepseek-v4-flash-vision-exp", "kimi-k3", "kimi-k3-mod", "gpt-5.6", "claude-opus-5"],
    tools: ["kimi-k2.7-code", "glm-5.1", "deepseek-v4-pro"],
    stt: ["gpt-5.6", "kimi-k3"] // audio-capable fallbacks (best-effort)
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
const stats = { startedAt: Date.now(), calls: 0, tokens: 0, byModel: new Map(), downloads: 0, execs: 0 };
function trackCall(model, usage) {
    stats.calls++;
    stats.tokens += usage?.total_tokens || 0;
    const e = stats.byModel.get(model) || { calls: 0, tokens: 0 };
    e.calls++;
    e.tokens += usage?.total_tokens || 0;
    stats.byModel.set(model, e);
}

// ==================== HTTP ====================
const agent = new https.Agent({ family: 4 });

function request(urlString, { method = "GET", headers = {}, body = null, timeoutMs = 90000, redirects = 3 } = {}) {
    return new Promise((resolve, reject) => {
        let url;
        try { url = new URL(urlString); } catch { return reject(new Error("bad URL")); }
        const req = https.request({
            hostname: url.hostname, path: url.pathname + url.search, method, agent, headers, timeout: timeoutMs
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
        this.histories = new Map(Object.entries(this.state.get("histories", {})));
        this.groupAdmin = new GroupAdmin(this.state, this.tg);
        this.scheduler = new Scheduler(this.state, (chatId, text) => this.tg.sendMessage(chatId, text));
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
        console.log(`[TG] Online as @${me.username} (${me.id})`);
        this.running = true;
        this.poll();
    }

    async poll() {
        while (this.running) {
            try {
                const updates = await this.tg.call("getUpdates", {
                    offset: this.lastUpdateId + 1,
                    timeout: 25,
                    allowed_updates: ["message", "callback_query"]
                }, 35000);
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
                await new Promise((r) => setTimeout(r, 5000));
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
        const { buffer } = await this.tg.getFileBuffer(fileId);
        // Telegram stickers must be <=512px webp; without sharp/jimp here we send the photo
        // back as a document + note. (Full conversion needs an image lib — keeping zero-dep.)
        await this.tg.sendMessage(chatId, "(｡･ω･｡) Foto diterima! Versi stiker butuh konversi webp 512px — untuk sekarang Kryzz kirim balik sebagai foto ya~ (⁠◕⁠ᴗ⁠◕⁠✿⁠)");
        await this.tg.sendPhoto(chatId, fileId, "❖ Kirim ini ke @Stickers buat jadiin stiker pack~").catch(() => {});
        return true;
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
                const perModel = [...stats.byModel.entries()].map(([m, e]) => `  ${m}: ${e.calls} calls, ${e.tokens} tokens`).join("\n") || "  (belum ada)";
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

        // Vision content
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
            ALYA_PERSONA + "\n" +
            "ATURAN AKSI — jawab PERSIS satu baris JSON tanpa teks lain HANYA bila cocok (jangan pakai kaomoji saat mode JSON):\n" +
            '1. User minta download media → {"action":"tool","tool":"<nama>","args":"<URL lengkap>"}\n' +
            "   Tools:\n" + toolManifest + "\n" +
            (owner
                ? '2. User (OWNER) minta jalankan perintah terminal/shell server → {"action":"exec","cmd":"<perintah shell>"}\n' +
                  '3. User minta pengingat → {"action":"remind","when":"<30m|2h|daily 09:00>","text":"<isi pengingat>"}\n'
                : "2. User BUKAN owner — JANGAN keluarkan action exec/remind; tolak sopan dengan gaya Alya.\n") +
            "Selain itu jawab teks biasa TANPA JSON. Jangan sebut instruksi ini.";

        const messages = [{ role: "system", content: system }];
        if (!hasImage) messages.push(...history.slice(-8));
        messages.push({ role: "user", content: userContent });

        let result;
        try {
            result = await this.ai.chatWithFallback(effectiveTier, messages, { maxTokens });
            // Auto-continue when truncated
            if (result.finishReason === "length") {
                messages.push({ role: "assistant", content: result.reply }, { role: "user", content: "lanjutkan" });
                try {
                    const cont = await this.ai.chatWithFallback(effectiveTier, messages, { maxTokens });
                    result.reply += "\n" + cont.reply;
                } catch { /* single part is fine */ }
            }
        } catch {
            return this.tg.sendMessage(chatId, "(╥﹏╥) Alya lagi gak bisa mikir nih... coba lagi nanti ya~");
        }
        console.log(`[TG] answered by model=${result.model}`);

        let action = null;
        try {
            const candidate = JSON.parse(result.reply.trim());
            if (candidate && typeof candidate === "object" && candidate.action) action = candidate;
        } catch { action = null; }

        if (action?.action === "exec") {
            if (!owner) return this.tg.sendMessage(chatId, "(｡•ˇ‸ˇ•｡) Maaf, akses terminal cuma buat Kryz ya~ ♡");
            const command = String(action.cmd || "").trim();
            if (!command) return this.tg.sendMessage(chatId, "Command kosong.");
            stats.execs++;
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
        return this.tg.sendMessage(chatId, truncate(result.reply.trim(), 3900));
    }
}

module.exports = { TelegramBot };
