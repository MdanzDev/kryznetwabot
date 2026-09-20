// anime.js — Sanka anime API wrapper (otakudesu backend)
// Flow: search -> detail (episodes) -> episode (stream/download servers)
// Rate limit: 30 req/min — keep calls lean, cache aggressively.
//
// v2 changes:
//  - resolveQuality no longer dies the moment ONE server is down. It tries
//    the server you asked for first, then automatically walks every other
//    server/quality combo available for that episode until one actually
//    returns a real video. This is the fix for "server unreachable" spam —
//    the upstream otakudesu mirrors rotate/die constantly, so we just need
//    to not give up after the first dead one.
//  - Unknown server names (anything that isn't yourupload/mp4load/desudesu2)
//    now go through a generic embed-page scraper instead of throwing
//    "belum disokong". That alone recovers a bunch of servers Sanka exposes
//    that we never bothered to special-case.
//  - uploadToCdn(): pushes the resolved mp4 to https://cdn.zass.in/upload
//    and hands back a plain URL, so callers don't need to move a video
//    buffer over WhatsApp at all.

const axios = require("axios");
const FormData = require("form-data"); // npm install form-data (if not already present)

const BASE = "https://www.sankavollerei.web.id/anime";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

// axios `timeout` only caps IDLE time between socket reads — a slow/dying server
// that keeps trickling bytes can stall a request forever (the 7:48pm SAO hang:
// download finished fine, but a wedged request never errored). Every remote
// fetch here runs under a hard wall-clock deadline that also aborts the socket.
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

// Small helper: retry a flaky network call a couple of times with backoff.
// Only retries on network-ish failures (no response / 5xx), not on 4xx or
// on our own deliberate abort errors — those mean "try a different server",
// not "try again".
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

// Cache: slug -> { data, at } — 10 min TTL, keeps us far under the rate limit
const cache = new Map();
const TTL = 10 * 60 * 1000;

async function j(path) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < TTL) return hit.data;
    const r = await withRetry(() =>
        fetchWithDeadline(BASE + path, { timeout: 20000, headers: UA, validateStatus: () => true }, 30000, "Sanka API")
    );
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

// detail -> { title, poster, synopsis, episodes, episodeList: [{episodeId, eps, title}] , genreList }
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
        // episodeList comes newest-first; sort oldest-first by eps number
        episodes: (d.episodeList || [])
            .slice()
            .sort((a, b) => (a.eps || 0) - (b.eps || 0))
            .map(e => ({
                eps: e.eps,
                episodeId: e.episodeId,
                title: e.title,
                href: e.href
            }))
    };
}

// episode -> { title, servers: [{quality, name, serverId}], downloadUrl, prev, next }
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

// resolve serverId -> { url } (the actual embed/stream page/URL)
async function server(serverId) {
    const d = await withRetry(() => j("/server/" + serverId));
    return { url: d.url || d.embedUrl || d.streamingUrl || null, data: d };
}

// Extract a direct mp4 from an arbitrary embed/player page. Used both as the
// desudesu2-specific path and as the generic fallback for any server name we
// don't have bespoke logic for. Falls back to null (caller then tries the
// next candidate).
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
        // <video><source src="...mp4" type="video/mp4">
        const videoSrc = html.match(/<source\s+src="([^"]+)"/i);
        if (videoSrc) return videoSrc[1];
        const videoTag = html.match(/<video[^>]+src="([^"]+)"/i);
        if (videoTag) return videoTag[1];
        // common JW/Plyr/Clappr style player configs
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

// Download a resolved video URL into a buffer, under a hard deadline, and
// sanity-check the size so a dead/placeholder response doesn't look "ok".
async function downloadBuffer(url, referer, label) {
    const r = await fetchWithDeadline(url, {
        timeout: 240000, family: 4, responseType: "arraybuffer", validateStatus: () => true,
        headers: { "User-Agent": UA["User-Agent"], Referer: referer }
    }, 300000, label);
    if (r.status !== 200) throw new Error(`${label}: HTTP ${r.status}`);
    if (!r.data || r.data.length < 100000) throw new Error(`${label}: fail terlalu kecil (${r.data?.length || 0} bytes)`);
    return Buffer.from(r.data);
}

// ---- per-server chains for the mirrors we know are usually reliable ----

async function chainYourupload(pick) {
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
    const buffer = await downloadBuffer(vc, inner, "vidcache download");
    return { buffer, source: "yourupload" };
}

async function chainMp4load(pick) {
    const sv = await server(pick.serverId);
    if (!sv.url) throw new Error("mp4load: pelayan tiada URL");
    const r = await withRetry(() =>
        fetchWithDeadline(sv.url, { timeout: 20000, headers: { ...UA, Referer: "https://otakudesu.blog/" }, validateStatus: () => true, maxRedirects: 5 }, 30000, "mp4load page")
    );
    const mp4 = String(r.data || "").match(/https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*/);
    if (!mp4) throw new Error("mp4load: video dipindah/dipadam di sumber");
    const buffer = await downloadBuffer(mp4[0], sv.url, "mp4load download");
    return { buffer, source: "mp4load" };
}

async function chainDesudesu2(pick, ep) {
    const url = await extractMp4(ep.defaultStreamingUrl, "https://desustream.me/");
    if (!url) throw new Error("desudesu2: stream tak dapat dibaca (URL terikat sesi)");
    const buffer = await downloadBuffer(url, "https://desustream.me/", "googlevideo download");
    return { buffer, source: "desudesu2" };
}

// Generic fallback for any server name we don't special-case: resolve the
// server, treat whatever URL it hands back as either a direct file or an
// embed page to scrape. Covers new/unknown mirrors without code changes.
async function chainGeneric(pick) {
    const sv = await server(pick.serverId);
    if (!sv.url) throw new Error(`${pick.name}: pelayan tiada URL`);
    let target = sv.url;
    if (!/\.(mp4|m3u8)(\?|$)/i.test(target)) {
        const extracted = await extractMp4(sv.url);
        if (!extracted) throw new Error(`${pick.name}: tak dapat extract video dari pelayan ni`);
        target = extracted;
    }
    const buffer = await downloadBuffer(target, sv.url, `${pick.name} download`);
    return { buffer, source: pick.name };
}

async function resolveOne(pick, ep) {
    if (pick.name === "yourupload") return chainYourupload(pick);
    if (pick.name === "mp4load") return chainMp4load(pick);
    if (pick.name === "desudesu2") return chainDesudesu2(pick, ep);
    return chainGeneric(pick);
}

// Build a priority-ordered candidate list: the server the user actually
// picked first, then the rest of that same quality, then everything else
// ordered by preferred quality. This is what lets us survive one dead
// mirror without bothering the user again.
function orderCandidates(servers, quality, serverName) {
    const qualityRank = ["720p", "480p", "360p"];
    const primary = servers.filter(s =>
        s.quality.toLowerCase() === quality.toLowerCase() && (!serverName || s.name === serverName));
    const sameQualityRest = servers.filter(s =>
        s.quality.toLowerCase() === quality.toLowerCase() && !primary.includes(s));
    const others = servers
        .filter(s => s.quality.toLowerCase() !== quality.toLowerCase())
        .sort((a, b) => qualityRank.indexOf(a.quality) - qualityRank.indexOf(b.quality));
    return [...primary, ...sameQualityRest, ...others];
}

// Resolve a fresh mp4 for a requested quality (+ optional preferred server),
// automatically falling back through every other server/quality on the
// episode if the preferred one is down. Returns
// { buffer, quality, source, requestedQuality, requestedServer, usedFallback }
// or throws with every attempt's error rolled up.
async function resolveQuality(episodeId, quality, serverName) {
    const ep = await episode(episodeId);
    quality = quality.toLowerCase();
    const candidates = orderCandidates(ep.servers, quality, serverName);
    if (!candidates.length) throw new Error("Episode ni tiada pelayan streaming langsung.");

    const errors = [];
    for (let i = 0; i < candidates.length; i++) {
        const pick = candidates[i];
        try {
            const { buffer, source } = await resolveOne(pick, ep);
            return {
                buffer,
                quality: pick.quality,
                source,
                requestedQuality: quality,
                requestedServer: serverName || null,
                usedFallback: i > 0
            };
        } catch (e) {
            errors.push(`${pick.quality}/${pick.name}: ${String(e.message).slice(0, 70)}`);
        }
    }
    throw new Error(`Semua ${candidates.length} pelayan gagal:\n` + errors.join("\n"));
}

// Kept for callers that just want "best available", no specific server in mind.
async function resolveEpisodeVideo(episodeId) {
    return resolveQuality(episodeId, "720p", null);
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
        }), { retries: 1 });
    if (!r.data?.success) throw new Error(r.data?.error || "Upload ke CDN gagal");
    return {
        url: r.data.url,
        fileName: r.data.fileName,
        fileId: r.data.fileId,
        size: r.data.size
    };
}

module.exports = {
    search, detail, episode, server, extractMp4,
    resolveEpisodeVideo, resolveQuality, uploadToCdn
};
        
