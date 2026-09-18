// anime.js — Sanka anime API wrapper (otakudesu backend)
// Flow: search -> detail (episodes) -> episode (stream/download servers)
// Rate limit: 30 req/min — keep calls lean, cache aggressively.

const axios = require("axios");

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

// Cache: slug -> { data, at } — 10 min TTL, keeps us far under the rate limit
const cache = new Map();
const TTL = 10 * 60 * 1000;

async function j(path) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < TTL) return hit.data;
    const r = await fetchWithDeadline(BASE + path, { timeout: 20000, headers: UA, validateStatus: () => true }, 30000, "Sanka API");
    if (r.status !== 200 || !r.data?.ok) {
        throw new Error(r.data?.statusMessage || r.data?.message || `API ${r.status}`);
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

// episode -> { title, servers: [{quality, serverList}], downloadUrl, prev, next }
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

// resolve serverId -> { url } (the actual embed/stream URL)
async function server(serverId) {
    const d = await j("/server/" + serverId);
    return { url: d.url || d.embedUrl || d.streamingUrl || null, data: d };
}

// Extract a direct mp4 from the desustream/otakuwatch embed if possible.
// Falls back to null (caller then offers the embed link + download links).
async function extractMp4(embedUrl) {
    if (!embedUrl) return null;
    try {
        const r = await fetchWithDeadline(embedUrl, {
            timeout: 15000,
            headers: { ...UA, Referer: "https://otakudesu.blog/" },
            validateStatus: () => true
        }, 30000, "desustream embed");
        if (r.status !== 200) return null;
        const html = String(r.data || "");
        // desustream pages: <video><source src="...googlevideo...mp4" type="video/mp4">
        const videoSrc = html.match(/<source\s+src="([^"]+)"/i);
        if (videoSrc) return videoSrc[1];
        const videoTag = html.match(/<video[^>]+src="([^"]+)"/i);
        if (videoTag) return videoTag[1];
        // common player patterns
        const patterns = [
            /(?:file|source)\s*[:=]\s*["'](https?:\/\/[^"']+?\.mp4[^"']*)["']/i,
            /"(https?:\/\/[^"']+?\.mp4(?:\?[^"']*)?)"/i
        ];
        for (const re of patterns) {
            const m = html.match(re);
            if (m) return m[1];
        }
        return null;
    } catch { return null; }
}

// Resolve a FRESH mp4 for a SPECIFIC quality+server selection by walking
// Sanka's server chain. Returns { buffer, quality, source } or throws.
// Supported chains: yourupload (vidcache), desudesu2 (googlevideo).
async function resolveEpisodeVideo(episodeId, refererPage) {
    const ep = await episode(episodeId);
    const want = ["720p", "480p", "360p"];
    const errors = [];

    // 1) yourupload chain: Sanka server -> desudrive page -> yourupload embed
    //    -> vidcache mp4 (streams with Referer = yourupload embed URL)
    for (const quality of want) {
        const yu = ep.servers.find(s => s.quality === quality && s.name === "yourupload");
        if (!yu) continue;
        try {
            const sv = await server(yu.serverId);
            const desudrive = sv.url;
            if (!desudrive) throw new Error("no desudrive url");
            const r1 = await fetchWithDeadline(desudrive, { timeout: 20000, headers: { "User-Agent": UA["User-Agent"], Referer: "https://otakudesu.blog/" }, validateStatus: () => true }, 30000, "desudrive");
            const inner = String(r1.data || "").match(/src="(https:\/\/yourupload\.com\/embed\/[^"]+)"/)?.[1];
            if (!inner) throw new Error("no yourupload iframe");
            const r2 = await fetchWithDeadline(inner, { timeout: 20000, headers: { "User-Agent": UA["User-Agent"], Referer: "https://desudrive.com/" }, validateStatus: () => true }, 30000, "yourupload embed");
            const vc = String(r2.data || "").match(/file\s*:\s*["']([^"']+)["']/i)?.[1];
            if (!vc) throw new Error("no vidcache url");
            const r3 = await fetchWithDeadline(vc, {
                timeout: 240000, family: 4, responseType: "arraybuffer", validateStatus: () => true,
                headers: { "User-Agent": UA["User-Agent"], Referer: inner }
            }, 300000, "vidcache download");
            if (r3.status === 200 && r3.data.length > 100000) {
                return { buffer: r3.data, quality, source: "yourupload" };
            }
            errors.push(`yourupload ${quality}: HTTP ${r3.status}`);
        } catch (e) {
            errors.push(`yourupload ${quality}: ${e.message.slice(0, 50)}`);
        }
    }

    // 2) mp4load / other direct-mp4 servers
    for (const quality of want) {
        const cand = ep.servers.find(s => s.quality === quality && s.name === "mp4load");
        if (!cand) continue;
        try {
            const sv = await server(cand.serverId);
            if (!sv.url) throw new Error("no url");
            const r = await fetchWithDeadline(sv.url, { timeout: 20000, headers: { ...UA, Referer: "https://otakudesu.blog/" }, validateStatus: () => true, maxRedirects: 5 }, 30000, "mp4load page");
            const mp4 = String(r.data || "").match(/https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*/);
            if (!mp4) throw new Error("no mp4 in page");
            const r2 = await fetchWithDeadline(mp4[0], {
                timeout: 240000, family: 4, responseType: "arraybuffer", validateStatus: () => true,
                headers: { "User-Agent": UA["User-Agent"], Referer: sv.url }
            }, 300000, "mp4load download");
            if (r2.status === 200 && r2.data.length > 100000) {
                return { buffer: r2.data, quality, source: "mp4load" };
            }
            errors.push(`mp4load ${quality}: HTTP ${r2.status}`);
        } catch (e) {
            errors.push(`mp4load ${quality}: ${e.message.slice(0, 50)}`);
        }
    }

    // 3) desudesu2 (googlevideo) — works only sometimes; try fresh extraction
    const desu = ep.servers.find(s => s.name === "desudesu2");
    if (desu && ep.defaultStreamingUrl) {
        try {
            const url = await extractMp4(ep.defaultStreamingUrl);
            if (url) {
                const r = await fetchWithDeadline(url, {
                    timeout: 240000, family: 4, responseType: "arraybuffer", validateStatus: () => true,
                    headers: { "User-Agent": UA["User-Agent"], Referer: "https://desustream.me/" }
                }, 300000, "googlevideo download");
                if (r.status === 200 && r.data.length > 100000) {
                    return { buffer: r.data, quality: "480p", source: "desudesu2" };
                }
                errors.push(`desudesu2: HTTP ${r.status}`);
            }
        } catch (e) {
            errors.push(`desudesu2: ${e.message.slice(0, 50)}`);
        }
    }

    throw new Error("Semua server gagal: " + errors.slice(0, 3).join("; "));
}

// Resolve a fresh mp4 for a SPECIFIC quality+server picked by the user.
// Returns { buffer, quality, source } or throws with a readable error.
async function resolveQuality(episodeId, quality, serverName) {
    const ep = await episode(episodeId);
    quality = quality.toLowerCase();
    const pick = ep.servers.find(s =>
        s.quality.toLowerCase() === quality && (!serverName || s.name === serverName));
    if (!pick) {
        const avail = [...new Set(ep.servers.filter(s => s.quality === quality).map(s => s.name))].join(", ") || "tiada";
        throw new Error(`Server "${serverName || quality}" tiada. Yang ada untuk ${quality}: ${avail}`);
    }

    if (pick.name === "yourupload") {
        const sv = await server(pick.serverId);
        const desudrive = sv.url;
        if (!desudrive) throw new Error("Pelayan yourupload tiada URL.");
        const r1 = await fetchWithDeadline(desudrive, { timeout: 20000, headers: { "User-Agent": UA["User-Agent"], Referer: "https://otakudesu.blog/" }, validateStatus: () => true }, 30000, "desudrive");
        const inner = String(r1.data || "").match(/src="(https:\/\/yourupload\.com\/embed\/[^"]+)"/)?.[1];
        if (!inner) throw new Error("Iframe yourupload tak jumpa.");
        const r2 = await fetchWithDeadline(inner, { timeout: 20000, headers: { "User-Agent": UA["User-Agent"], Referer: "https://desudrive.com/" }, validateStatus: () => true }, 30000, "yourupload embed");
        const vc = String(r2.data || "").match(/file\s*:\s*["']([^"']+)["']/i)?.[1];
        if (!vc) throw new Error("Link video vidcache tak jumpa.");
        const r3 = await fetchWithDeadline(vc, {
            timeout: 240000, family: 4, responseType: "arraybuffer", validateStatus: () => true,
            headers: { "User-Agent": UA["User-Agent"], Referer: inner }
        }, 300000, "vidcache download");
        if (r3.status === 200 && r3.data.length > 100000) {
            return { buffer: r3.data, quality, source: "yourupload" };
        }
        throw new Error(`Vidcache pulang HTTP ${r3.status}. Pelayan lain mungkin boleh.`);
    }

    if (pick.name === "mp4load") {
        const sv = await server(pick.serverId);
        if (!sv.url) throw new Error("Pelayan mp4load tiada URL.");
        const r = await fetchWithDeadline(sv.url, { timeout: 20000, headers: { ...UA, Referer: "https://otakudesu.blog/" }, validateStatus: () => true, maxRedirects: 5 }, 30000, "mp4load page");
        const mp4 = String(r.data || "").match(/https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*/);
        if (!mp4) throw new Error("mp4load: video dipindah atau dipadam.");
        const r2 = await fetchWithDeadline(mp4[0], {
            timeout: 240000, family: 4, responseType: "arraybuffer", validateStatus: () => true,
            headers: { "User-Agent": UA["User-Agent"], Referer: sv.url }
        }, 300000, "mp4load download");
        if (r2.status === 200 && r2.data.length > 100000) {
            return { buffer: r2.data, quality, source: "mp4load" };
        }
        throw new Error(`mp4load pulang HTTP ${r2.status}.`);
    }

    if (pick.name === "desudesu2") {
        const url = await extractMp4(ep.defaultStreamingUrl).catch(() => null);
        if (!url) throw new Error("Stream desudesu2 tak dapat dibaca.");
        const r = await fetchWithDeadline(url, {
            timeout: 240000, family: 4, responseType: "arraybuffer", validateStatus: () => true,
            headers: { "User-Agent": UA["User-Agent"], Referer: "https://desustream.me/" }
        }, 300000, "googlevideo download");
        if (r.status === 200 && r.data.length > 100000) {
            return { buffer: r.data, quality, source: "desudesu2" };
        }
        throw new Error(`Desudesu2 pulang HTTP ${r.status} (URL terikat sesi).`);
    }

    throw new Error(`Server "${pick.name}" belum disokong. Cuba server lain.`);
}

module.exports = { search, detail, episode, server, extractMp4, resolveEpisodeVideo, resolveQuality };
