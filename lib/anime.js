// anime.js — Sanka anime API wrapper (otakudesu backend)
// Flow: search -> detail (episodes) -> episode (stream/download servers)
// Rate limit: 30 req/min — enforced in-process, see throttleApiCall().
//
// v3 changes (on top of v2's fallback-walk + hard-timeout fixes):
//  1. Direct download links (ep.download) are tried BEFORE the embed-scraping
//     server chain — file hosts are generally more stable than re-scraping a
//     player embed every time.
//  2. downloadBuffer() now checks magic bytes so a 200 OK HTML error page
//     that happens to be >100KB doesn't get treated as a valid video.
//  3. Resolved playable URLs (not the video buffers — those aren't cached,
//     only the URL string) are cached per episode+quality+server for 5 min,
//     so a retry or a second user hitting the same episode skips straight to
//     download instead of re-scraping the embed chain.
//  4. Servers/hosts get a rolling success/fail count and candidates are
//     sorted by that reliability score, so a server that's been failing
//     repeatedly gets pushed toward the back of the queue automatically.
//  5. resolveQuality() takes an optional onProgress(info) callback, called
//     before each candidate attempt, so a caller (the bot) can ping the user
//     during a long fallback walk instead of going silent.
//  6. throttleApiCall() enforces the 30 req/min cap in-process across every
//     call to the Sanka API, queuing instead of firing over the limit.
//  7. uploadToCdn(): pushes the resolved mp4 to https://cdn.zass.in/upload
//     and hands back a plain URL.

const axios = require("axios");
const FormData = require("form-data"); // npm install form-data (if not already present)

const BASE = "https://www.sankavollerei.web.id/anime";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

// ---------------------------------------------------------------------
// Low-level fetch with a hard wall-clock deadline (axios `timeout` only
// caps IDLE time between socket reads — a slow/dying server that keeps
// trickling bytes can stall a request forever otherwise).
// ---------------------------------------------------------------------
function fetchWithDeadline(url, cfg, deadlineMs, label) {
    const ac = new AbortController();
    const secs = Math.round(deadlineMs / 1000);
    const timer = setTimeout(() => ac.abort(), deadlineMs);
    return axios.get(url, { ...cfg, signal: ac.signal }).catch(e => {
        if (e?.code === "ERR_CANCELED" || e?.name === "CanceledError") {
            throw new Error(`${label}: melebihi ${secs}s (dibatalkan)`);
        }
        throw e;
    }).finally(() => clearTimeout(timer));
}

async function withRetry(fn, { retries = 2, baseDelayMs = 800 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            const status = e?.response?.status;
            const retriable = !status || status >= 500;
            if (!retriable || attempt === retries) break;
            await new Promise(r => setTimeout(r, baseDelayMs * (attempt + 1)));
        }
    }
    throw lastErr;
}

// Races a promise against a hard timer that fires regardless of whether the
// underlying call respects its own AbortSignal — the real safety net against
// a mirror that hangs on DNS/connect and never triggers our own deadline.
function withHardTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: tamat tempoh keras (${Math.round(ms / 1000)}s)`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------
// In-process rate limiter for the Sanka API itself (documented 30 req/min).
// Every actual network call to BASE goes through here, including retries —
// this stops a flurry of fallback attempts from tripping a 429 that then
// looks like "random server down" errors.
// ---------------------------------------------------------------------
const RATE_LIMIT_PER_MIN = 30;
const RATE_WINDOW_MS = 60 * 1000;
let apiCallLog = [];

async function throttleApiCall() {
    const now = Date.now();
    apiCallLog = apiCallLog.filter(t => now - t < RATE_WINDOW_MS);
    if (apiCallLog.length >= RATE_LIMIT_PER_MIN) {
        const waitMs = RATE_WINDOW_MS - (now - apiCallLog[0]) + 50;
        await new Promise(r => setTimeout(r, waitMs));
        return throttleApiCall();
    }
    apiCallLog.push(Date.now());
}

// Cache: path -> { data, at } — 10 min TTL, keeps us far under the rate limit
const cache = new Map();
const TTL = 10 * 60 * 1000;

async function j(path) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < TTL) return hit.data;
    const r = await withRetry(async () => {
        await throttleApiCall();
        return fetchWithDeadline(BASE + path, { timeout: 20000, headers: UA, validateStatus: () => true }, 30000, "Sanka API");
    });
    if (r.status !== 200 || !r.data?.ok) {
        const detail = r.data?.statusMessage || r.data?.message || `API ${r.status}`;
        throw new Error(`Sanka API bermasalah (${path}): ${detail}`);
    }
    cache.set(path, { data: r.data.data, at: Date.now() });
    return r.data.data;
}

// search -> [{ animeId, title, poster, status, score }]
async function search(query) {
    const d = await j("/search/" + encodeURIComponent(query));
    return d?.animeList || [];
}

// detail -> { title, poster, synopsis, episodes, episodeList, genreList }
async function detail(slug) {
    const d = await j("/anime/" + slug);
    return {
        title: d.title,
        poster: d.poster,
        synopsis: d.synopsis,
        status: d.status,
        score: d.score,
        type: d.type,
        totalEpisodes: d.episodes,
        genres: (d.genreList || []).map(g => g.genreName || g.name).filter(Boolean),
        episodes: (d.episodeList || [])
            .slice()
            .sort((a, b) => (a.eps || 0) - (b.eps || 0))
            .map(e => ({ eps: e.eps, episodeId: e.episodeId, title: e.title, href: e.href }))
    };
}

// episode -> { title, servers: [{quality,name,serverId}], download: [{quality,size,urls:[{name,url}]}], prev, next }
async function episode(episodeId) {
    const d = await j("/episode/" + episodeId);
    const servers = [];
    for (const q of (d.server?.qualities || [])) {
        for (const s of (q.serverList || [])) {
            servers.push({ quality: q.title, name: s.title.trim(), serverId: s.serverId });
        }
    }
    return {
        title: d.title,
        defaultStreamingUrl: d.defaultStreamingUrl,
        servers,
        download: (d.downloadUrl?.qualities || []).map(q => ({
            quality: q.title,
            size: q.size,
            urls: (q.urls || []).map(u => ({ name: u.title, url: u.url }))
        })),
        prevEpisodeId: d.prevEpisode?.episodeId || (typeof d.prevEpisode === "string" ? d.prevEpisode : null),
        nextEpisodeId: d.nextEpisode?.episodeId || (typeof d.nextEpisode === "string" ? d.nextEpisode : null)
    };
}

async function server(serverId) {
    const d = await j("/server/" + serverId);
    return { url: d.url || d.embedUrl || d.streamingUrl || null, data: d };
}

async function extractMp4(embedUrl, referer = "https://otakudesu.blog/") {
    if (!embedUrl) return null;
    try {
        const r = await fetchWithDeadline(embedUrl, {
            timeout: 15000,
            headers: { ...UA, Referer: referer },
            validateStatus: () => true
        }, 30000, "embed page");
        if (r.status !== 200) return null;
        const html = String(r.data || "");
        const videoSrc = html.match(/<source\s+src="([^"]+)"/i);
        if (videoSrc) return videoSrc[1];
        const videoTag = html.match(/<video[^>]+src="([^"]+)"/i);
        if (videoTag) return videoTag[1];
        const patterns = [
            /(?:file|source|src)\s*[:=]\s*["'](https?:\/\/[^"']+?\.(?:mp4|m3u8)[^"']*)["']/i,
            /"(https?:\/\/[^"']+?\.(?:mp4|m3u8)(?:\?[^"']*)?)"/i
        ];
        for (const re of patterns) {
            const m = html.match(re);
            if (m) return m[1];
        }
        return null;
    } catch { return null; }
}

// ---------------------------------------------------------------------
// Payload validation: a 200 OK response that's actually an HTML error page,
// login wall, or "file deleted" placeholder can still be >100KB. Check the
// container's magic bytes rather than trusting size alone.
// ---------------------------------------------------------------------
function looksLikeVideo(buf) {
    if (!buf || buf.length < 16) return false;
    const asciiHead = buf.slice(0, 16).toString("ascii").toLowerCase();
    if (asciiHead.includes("<html") || asciiHead.includes("<!doctype") || asciiHead.startsWith("{") || asciiHead.startsWith("[")) {
        return false;
    }
    // mp4/mov/m4v family: 'ftyp' at byte offset 4
    if (buf.length > 8 && buf.toString("ascii", 4, 8) === "ftyp") return true;
    // webm/mkv (EBML header): 1A 45 DF A3
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true;
    // avi: RIFF....AVI
    if (buf.toString("ascii", 0, 4) === "RIFF") return true;
    // flv
    if (buf.toString("ascii", 0, 3) === "FLV") return true;
    // Unknown-but-binary: accept (some CDNs relocate/strip the box); we've
    // already ruled out the obvious HTML/JSON error-page cases above.
    return true;
}

async function downloadBuffer(url, referer, label) {
    const r = await fetchWithDeadline(url, {
        timeout: 240000, family: 4, responseType: "arraybuffer", validateStatus: () => true,
        headers: { "User-Agent": UA["User-Agent"], Referer: referer }
    }, 300000, label);
    if (r.status !== 200) throw new Error(`${label}: HTTP ${r.status}`);
    const buf = Buffer.from(r.data || []);
    if (buf.length < 100000) throw new Error(`${label}: fail terlalu kecil (${buf.length} bytes)`);
    if (!looksLikeVideo(buf)) throw new Error(`${label}: bukan fail video (nampak macam halaman ralat)`);
    return buf;
}

// ---------------------------------------------------------------------
// Per-server-name reliability tracking (in-memory, resets on process
// restart). Used to push chronically-failing servers to the back of the
// candidate queue instead of trying them first every time.
// ---------------------------------------------------------------------
const serverStats = new Map(); // name -> { success, fail }

function recordServerResult(name, ok) {
    const s = serverStats.get(name) || { success: 0, fail: 0 };
    if (ok) s.success++; else s.fail++;
    serverStats.set(name, s);
}

// Laplace-smoothed score: untried servers land at a neutral 0.5 instead of
// being punished for lack of data.
function reliabilityScore(name) {
    const s = serverStats.get(name);
    if (!s) return 0.5;
    return (s.success + 1) / (s.success + s.fail + 2);
}

function sortByReliability(list) {
    return list.slice().sort((a, b) => reliabilityScore(b.name) - reliabilityScore(a.name));
}

// ---------------------------------------------------------------------
// Per-candidate URL resolvers: each returns { url, referer } for a
// candidate WITHOUT downloading it, so the caller can cache the resolved
// URL separately from the (much heavier, not-worth-caching) video buffer.
// ---------------------------------------------------------------------
async function yourploadUrl(pick) {
    const sv = await server(pick.serverId);
    const desudrive = sv.url;
    if (!desudrive) throw new Error("yourupload: pelayan tiada URL");
    const r1 = await withRetry(() =>
        fetchWithDeadline(desudrive, { timeout: 20000, headers: { "User-Agent": UA["User-Agent"], Referer: "https://otakudesu.blog/" }, validateStatus: () => true }, 30000, "desudrive")
    );
    const inner = String(r1.data || "").match(/src="(https:\/\/yourupload\.com\/embed\/[^"]+)"/)?.[1];
    if (!inner) throw new Error("yourupload: iframe tak jumpa (mirror mungkin dah tukar layout)");
    const r2 = await fetchWithDeadline(inner, { timeout: 20000, headers: { "User-Agent": UA["User-Agent"], Referer: "https://desudrive.com/" }, validateStatus: () => true }, 30000, "yourupload embed");
    const vc = String(r2.data || "").match(/file\s*:\s*["']([^"']+)["']/i)?.[1];
    if (!vc) throw new Error("yourupload: link vidcache tak jumpa");
    return { url: vc, referer: inner };
}

async function mp4loadUrl(pick) {
    const sv = await server(pick.serverId);
    if (!sv.url) throw new Error("mp4load: pelayan tiada URL");
    const r = await withRetry(() =>
        fetchWithDeadline(sv.url, { timeout: 20000, headers: { ...UA, Referer: "https://otakudesu.blog/" }, validateStatus: () => true, maxRedirects: 5 }, 30000, "mp4load page")
    );
    const mp4 = String(r.data || "").match(/https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*/);
    if (!mp4) throw new Error("mp4load: video dipindah/dipadam di sumber");
    return { url: mp4[0], referer: sv.url };
}

async function desudesu2Url(pick, ep) {
    const url = await extractMp4(ep.defaultStreamingUrl, "https://desustream.me/");
    if (!url) throw new Error("desudesu2: stream tak dapat dibaca (URL terikat sesi)");
    return { url, referer: "https://desustream.me/" };
}

async function genericUrl(pick) {
    const sv = await server(pick.serverId);
    if (!sv.url) throw new Error(`${pick.name}: pelayan tiada URL`);
    if (/\.(mp4|m3u8)(\?|$)/i.test(sv.url)) return { url: sv.url, referer: sv.url };
    const extracted = await extractMp4(sv.url);
    if (!extracted) throw new Error(`${pick.name}: tak dapat extract video dari pelayan ni`);
    return { url: extracted, referer: sv.url };
}

async function getPlayableUrl(pick, ep) {
    if (pick.type === "direct") return { url: pick.url, referer: "https://otakudesu.blog/" };
    if (pick.name === "yourupload") return yourploadUrl(pick);
    if (pick.name === "mp4load") return mp4loadUrl(pick);
    if (pick.name === "desudesu2") return desudesu2Url(pick, ep);
    return genericUrl(pick);
}

// ---------------------------------------------------------------------
// Resolved-URL cache — 5 min TTL. Only the URL string is cached (video
// buffers are never kept around), so a retry or a second person hitting
// the same episode/quality/server skips the embed-scraping chain entirely
// and goes straight to download.
// ---------------------------------------------------------------------
const urlCache = new Map(); // "episodeId::quality::name" -> { url, referer, at }
const URL_CACHE_TTL = 5 * 60 * 1000;

async function resolveOne(pick, ep, episodeId) {
    const cacheKey = `${episodeId}::${pick.quality}::${pick.name}`;
    const cached = urlCache.get(cacheKey);
    if (cached && Date.now() - cached.at < URL_CACHE_TTL) {
        try {
            const buffer = await downloadBuffer(cached.url, cached.referer, `${pick.name} (cache)`);
            return { buffer, source: pick.name };
        } catch {
            urlCache.delete(cacheKey); // stale/expired link — fall through and re-resolve
        }
    }
    const { url, referer } = await getPlayableUrl(pick, ep);
    const buffer = await downloadBuffer(url, referer, `${pick.name} download`);
    urlCache.set(cacheKey, { url, referer, at: Date.now() });
    return { buffer, source: pick.name };
}

// ---------------------------------------------------------------------
// Candidate ordering: direct download links first (generally more stable
// than re-scraping an embed), then the user's explicitly requested
// streaming server, then the rest of that quality (sorted by reliability),
// then everything else.
// ---------------------------------------------------------------------
function buildCandidates(ep, quality, serverName) {
    quality = quality.toLowerCase();
    const streamAll = ep.servers.map(s => ({ type: "stream", quality: s.quality, name: s.name, serverId: s.serverId }));
    const directAll = (ep.download || []).flatMap(q =>
        (q.urls || []).map(u => ({ type: "direct", quality: q.quality, name: u.name, url: u.url }))
    );

    const sameQ = list => list.filter(c => c.quality.toLowerCase() === quality);
    const otherQ = list => list.filter(c => c.quality.toLowerCase() !== quality);
    const qualityRank = ["720p", "480p", "360p"];
    const rankOthers = list => list.slice().sort((a, b) => qualityRank.indexOf(a.quality) - qualityRank.indexOf(b.quality));

    const directSameQ = sortByReliability(sameQ(directAll));
    const requestedStream = serverName ? sameQ(streamAll).filter(s => s.name === serverName) : [];
    const streamSameQRest = sortByReliability(sameQ(streamAll).filter(s => !requestedStream.includes(s)));
    const directOtherQ = sortByReliability(rankOthers(otherQ(directAll)));
    const streamOtherQ = sortByReliability(rankOthers(otherQ(streamAll)));

    return [...directSameQ, ...requestedStream, ...streamSameQRest, ...directOtherQ, ...streamOtherQ];
}

const PER_CANDIDATE_TIMEOUT_MS = 4 * 60 * 1000;
const OVERALL_BUDGET_MS = 8 * 60 * 1000;

// Resolve a fresh mp4 for a requested quality (+ optional preferred server),
// trying direct downloads first and automatically falling back through every
// other server/quality if needed. `onProgress({index,total,quality,name,elapsedMs})`
// is called before each attempt so a caller can ping the user during a long walk.
// Returns { buffer, quality, source, requestedQuality, requestedServer, usedFallback }.
async function resolveQuality(episodeId, quality, serverName, onProgress) {
    const ep = await episode(episodeId);
    quality = quality.toLowerCase();
    const candidates = buildCandidates(ep, quality, serverName);
    if (!candidates.length) throw new Error("Episode ni tiada pelayan/muat turun langsung.");

    const start = Date.now();
    const errors = [];
    for (let i = 0; i < candidates.length; i++) {
        if (Date.now() - start > OVERALL_BUDGET_MS) {
            errors.push(`(berhenti awal — sudah cuba ${i}/${candidates.length} pelayan dalam ${Math.round((Date.now() - start) / 1000)}s)`);
            break;
        }
        const pick = candidates[i];
        if (typeof onProgress === "function") {
            try { onProgress({ index: i, total: candidates.length, quality: pick.quality, name: pick.name, elapsedMs: Date.now() - start }); } catch {}
        }
        try {
            const { buffer, source } = await withHardTimeout(
                resolveOne(pick, ep, episodeId), PER_CANDIDATE_TIMEOUT_MS, `${pick.quality}/${pick.name}`
            );
            recordServerResult(pick.name, true);
            return {
                buffer,
                quality: pick.quality,
                source,
                requestedQuality: quality,
                requestedServer: serverName || null,
                usedFallback: i > 0
            };
        } catch (e) {
            recordServerResult(pick.name, false);
            errors.push(`${pick.quality}/${pick.name}: ${String(e.message).slice(0, 70)}`);
        }
    }
    throw new Error(`Semua pelayan gagal (dicuba ${errors.length}):\n` + errors.join("\n"));
}

// Kept for callers that just want "best available", no specific server in mind.
async function resolveEpisodeVideo(episodeId, onProgress) {
    return resolveQuality(episodeId, "720p", null, onProgress);
}

// ---- CDN upload: hand back a watchable link instead of a raw buffer ----
async function uploadToCdn(buffer, filename = "video.mp4", contentType = "video/mp4") {
    const form = new FormData();
    form.append("file", buffer, { filename, contentType });
    const r = await withRetry(() =>
        axios.post("https://cdn.zass.in/upload", form, {
            headers: form.getHeaders(),
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 120000
        }),
