// anime.js — Sanka anime API wrapper (otakudesu backend)
// Flow: search -> detail (episodes) -> episode (stream/download servers)
// Rate limit: 30 req/min — keep calls lean, cache aggressively.

const axios = require("axios");

const BASE = "https://www.sankavollerei.web.id/anime";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

// Cache: slug -> { data, at } — 10 min TTL, keeps us far under the rate limit
const cache = new Map();
const TTL = 10 * 60 * 1000;

async function j(path) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < TTL) return hit.data;
    const r = await axios.get(BASE + path, { timeout: 20000, headers: UA, validateStatus: () => true });
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
        const r = await axios.get(embedUrl, {
            timeout: 15000,
            headers: { ...UA, Referer: "https://otakudesu.blog/" },
            validateStatus: () => true
        });
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

module.exports = { search, detail, episode, server, extractMp4 };
