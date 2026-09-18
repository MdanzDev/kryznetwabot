const anime = require("../../lib/anime.js");
const axios = require("axios");

// /anime <query>            — search (nativeFlow list: pick a title)
// /anime title:<slug>       — info card + "Senarai Episode" list button
// /anime eps:<slug>:<page>  — episode list (nativeFlow rows, 8/page + paging)
// /anime watch:<episodeId>  — send the video + prev/next + download buttons

const EPS_PER_PAGE = 8;
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

function fmtHeader(title) {
    return "╭───────────────୨୧\n" +
           `│  ₊˚⊹♡  ${title}  ♡⊹˚₊\n` +
           "╰───────────────୨୧\n\n";
}

// YouTube fallback: search "<title> episode <n>" then get a video mp4 via savetube
async function ytVideoForEpisode(title, eps) {
    try {
        const q = `${title} episode ${eps}`;
        const s = await axios.get("https://api.nexray.eu.cc/search/youtube?"+ new URLSearchParams({ q }), { timeout: 20000, headers: UA, validateStatus: () => true });
        const items = s.data?.result || [];
        if (!items.length) return null;
        // prefer the first result whose title mentions the episode number
        const ytUrl = items[0].url || items[0].link;
        if (!ytUrl) return null;
        for (const quality of ["360", "480", "720"]) {
            try {
                const r = await axios.get("https://api.nexray.eu.cc/downloader/savetube?" +
                    new URLSearchParams({ url: ytUrl, type: "video", quality }), { timeout: 30000, headers: UA, validateStatus: () => true });
                const d = r.data?.result;
                if (d?.url && d.type === "video") {
                    // validate the CDN link actually serves video
                    const h = await axios.head(d.url, { timeout: 15000, headers: UA, validateStatus: () => true });
                    if (h.status === 200 && /video/.test(h.headers["content-type"] || "")) {
                        return { url: d.url, source: "YouTube", ytTitle: d.title || items[0].title, thumb: d.thumbnail || items[0].thumbnail };
                    }
                }
            } catch { /* try next quality */ }
        }
        return null;
    } catch { return null; }
}

module.exports = {
    name: "anime",
    aliases: ["animes", "nonton"],
    category: "downloader",
    code: async (ctx) => {
        const input = (ctx.text || "").trim();
        const prefix = ctx.used.prefix;

        // ---------- /anime (no args) ----------
        if (!input)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                ctx.format.generateCmdExample(ctx.used, "sword art online") + "\n" +
                ctx.format.generateNotes([
                    "Cari anime, pilih judul → pilih episode → tonton!",
                    "Contoh: /anime naruto"
                ])
            );

        // ---------- /anime watch:<episodeId> ----------
        if (input.startsWith("watch:")) {
            const episodeId = input.slice(6).trim();
            try {
                const ep = await anime.episode(episodeId);
                const nav = [];
                if (ep.prevEpisodeId) nav.push({ text: "❮ Ep Sebelum", id: `${prefix}anime watch:${ep.prevEpisodeId}` });
                if (ep.nextEpisodeId) nav.push({ text: "Ep Seterusnya ❯", id: `${prefix}anime watch:${ep.nextEpisodeId}` });
                const cleanTitle = ep.title.replace(/Subtitle Indonesia/gi, "").trim();

                // Path 1: direct mp4 from the Sanka stream player
                let videoUrl = null, videoLabel = "Sanka", thumb = null;
                if (ep.defaultStreamingUrl) {
                    videoUrl = await anime.extractMp4(ep.defaultStreamingUrl).catch(() => null);
                }

                // Path 2: YouTube fallback (search episode → savetube video mp4)
                if (!videoUrl) {
                    const m = episodeId.match(/episode-(\d+)/);
                    const epNum = m ? m[1] : "";
                    const baseTitle = cleanTitle.replace(/\s*Episode\s*\d+.*$/i, "").replace(/\s*\(End\)\s*$/i, "");
                    const yt = await ytVideoForEpisode(baseTitle, epNum);
                    if (yt) {
                        videoUrl = yt.url;
                        videoLabel = "YouTube";
                        thumb = yt.thumb;
                    }
                }

                if (videoUrl) {
                    const cap = `❖ ${cleanTitle}\n✦ Sumber: ${videoLabel}\n\n${nav.length ? "▶ Butang di bawah untuk pindah episode!" : ""}`;
                    // video from URL with fallback to caption-only card if upload fails
                    try {
                        await ctx.reply({
                            video: { url: videoUrl },
                            ...(thumb ? { jpegThumbnail: undefined } : {}),
                            caption: cap,
                            buttons: nav.length ? nav : undefined
                        });
                        return;
                    } catch (sendErr) {
                        console.log("[anime] video send failed, falling back to link card:", sendErr.message?.slice(0, 80));
                    }
                }

                // Fallback card: stream page + download hosts
                const urlBtns = [];
                if (ep.defaultStreamingUrl) urlBtns.push({ text: "▶ Tonton Online", url: ep.defaultStreamingUrl });
                const dl = ep.download[0];
                if (dl?.urls?.[0]) urlBtns.push({ text: `⬇ ${dl.quality}${dl.size ? " (" + dl.size.trim() + ")" : ""}`, url: dl.urls[0].url });
                const all = [...nav, ...urlBtns].slice(0, 3);
                return await ctx.reply({
                    text: fmtHeader("🎬 TONTON EPISODE") +
                        `❖ ${cleanTitle}\n\n` +
                        (ep.download.length ? `✦ Download: ${ep.download.map(q => q.quality).join(", ")}\n` : "") +
                        `\n✦ Server video tak dapat dihantar terus — guna butang 'Tonton Online' buka dalam browser ya~`,
                    buttons: all.length ? all : undefined
                });
            } catch (e) {
                return await ctx.reply(ctx.format.info(`(╥﹏╥) Gagal ambil episode: ${String(e.message).slice(0, 100)}`));
            }
        }

        // ---------- /anime eps:<slug>:<page> ----------
        if (input.startsWith("eps:")) {
            const [, slug, pageStr] = input.slice(4).match(/([^:]+):?(\d+)?/) || [];
            const page = Math.max(1, parseInt(pageStr || "1", 10));
            try {
                const d = await anime.detail(slug);
                const total = d.episodes.length;
                const maxPage = Math.max(1, Math.ceil(total / EPS_PER_PAGE));
                const slice = d.episodes.slice((page - 1) * EPS_PER_PAGE, page * EPS_PER_PAGE);

                const rows = slice.map(e => ({
                    title: `❖ Episode ${e.eps}`,
                    description: String(e.title || "").replace(/Subtitle Indonesia/gi, "").trim().slice(0, 40),
                    id: `${prefix}anime watch:${e.episodeId}`
                }));

                const pgRows = [];
                if (page > 1) pgRows.push({ title: "❮ Halaman Sebelum", id: `${prefix}anime eps:${slug}:${page - 1}` });
                if (page < maxPage) pgRows.push({ title: "Halaman Seterusnya ❯", id: `${prefix}anime eps:${slug}:${page + 1}` });

                const sections = [{ title: `୨୧ Episode (halaman ${page}/${maxPage})`, rows }];
                if (pgRows.length) sections.push({ title: "୨୧ Navigasi", rows: pgRows });

                return await ctx.reply({
                    text: fmtHeader(d.title.slice(0, 40)) +
                        `✦ Status  › ${d.status || "?"}\n` +
                        `✦ Episode › ${total} total | halaman ${page}/${maxPage}\n` +
                        (d.score ? `✦ Skor    › ${d.score}\n` : "") +
                        `\n✦ Pilih episode dari senarai bawah ya~ ♡`,
                    optionText: "♡ Pilih Episode",
                    optionTitle: "୨୧ Senarai Episode",
                    nativeFlow: [{
                        text: "♡ Pilih Episode",
                        sections
                    }]
                });
            } catch (e) {
                return await ctx.reply(ctx.format.info(`(╥﹏╥) ${String(e.message).slice(0, 100)}`));
            }
        }

        // ---------- /anime title:<slug> ----------
        if (input.startsWith("title:")) {
            const slug = input.slice(6).trim();
            try {
                const d = await anime.detail(slug);
                const info =
                    `✦ Status  › ${d.status || "?"}\n` +
                    `✦ Episode › ${d.totalEpisodes || d.episodes.length}\n` +
                    `✦ Skor    › ${d.score || "?"}\n` +
                    `✦ Genre   › ${d.genres.slice(0, 5).join(", ")}\n\n` +
                    `❖ Sinopsis:\n${String(d.synopsis || "-").slice(0, 300)}...`;
                return await ctx.reply({
                    ...(d.poster
                        ? { image: { url: d.poster }, caption: fmtHeader(d.title.slice(0, 45)) + info }
                        : { text: fmtHeader(d.title.slice(0, 45)) + info }),
                    buttons: [{ text: "୨୧ Senarai Episode", id: `${prefix}anime eps:${slug}:1` }]
                });
            } catch (e) {
                return await ctx.reply(ctx.format.info(`(╥﹏╥) ${String(e.message).slice(0, 100)}`));
            }
        }

        // ---------- /anime <query> — SEARCH ----------
        try {
            const results = await anime.search(input);
            if (!results.length)
                return await ctx.reply(ctx.format.info(config.msg.notFound));

            const rows = results.slice(0, 10).map(r => ({
                title: r.title.replace(/Subtitle Indonesia|Sub Indo/gi, "").trim().slice(0, 50),
                description: `${r.status || "?"} • ⭐${r.score || "?"}`,
                id: `${prefix}anime title:${r.animeId}`
            }));

            return await ctx.reply({
                text: fmtHeader("𝑯𝒂𝒔𝒊𝒍 𝑺𝒆𝒂𝒓𝒄𝒉") +
                    `❖ Kata kunci: ${ctx.format.inlineCode(input)}\n` +
                    `❖ Ditemui: ${results.length} anime\n\n` +
                    "✦ Pilih judul dari senarai untuk lihat episode! ♡",
                optionText: "♡ Pilih Anime",
                optionTitle: "୨୧ Hasil Pencarian",
                nativeFlow: [{
                    text: "♡ Pilih Anime",
                    sections: [{ title: "୨୧ Hasil Pencarian", rows }]
                }]
            });
        } catch (e) {
            return await ctx.reply(ctx.format.info(`(╥﹏╥) Pencarian gagal: ${String(e.message).slice(0, 100)}`));
        }
    }
};
