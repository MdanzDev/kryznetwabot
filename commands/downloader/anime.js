const anime = require("../../lib/anime.js");

// /anime <query>                       — search, page 1 (nativeFlow list)
// /anime search:<b64query>:<page>      — search, other pages
// /anime title:<slug>                  — info card + "Senarai Episode" list button
// /anime eps:<slug>:<page>             — episode list (nativeFlow rows, 8/page + paging)
// /anime watch:<episodeId>             — quality/server picker
// /anime get:<episodeId>:<quality>:<server> — resolve (auto-fallback) + upload to CDN + send link

const EPS_PER_PAGE = 12;
const SEARCH_PER_PAGE = 20;
const PROGRESS_PING_INTERVAL_MS = 20000; // don't ping more often than this during a fallback walk

function fmtHeader(title) {
    return "╭───────────────୨୧\n" +
           `│  ₊˚⊹♡  ${title}  ♡⊹˚₊\n` +
           "╰───────────────୨୧\n\n";
}

// Search queries can contain spaces/punctuation that don't survive a ":"-
// delimited command id cleanly, so pack them as base64url for the nativeFlow
// row ids and unpack on the way back in.
function encodeQuery(q) { return Buffer.from(q, "utf8").toString("base64url"); }
function decodeQuery(b) { return Buffer.from(b, "base64url").toString("utf8"); }

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

        // ---------- shared: render one page of search results ----------
        async function renderSearchPage(query, page) {
            const results = await anime.search(query);
            if (!results.length)
                return await ctx.reply(ctx.format.info(config.msg.notFound));

            const maxPage = Math.max(1, Math.ceil(results.length / SEARCH_PER_PAGE));
            page = Math.min(Math.max(1, page), maxPage);
            const slice = results.slice((page - 1) * SEARCH_PER_PAGE, page * SEARCH_PER_PAGE);
            const qEnc = encodeQuery(query);

            const rows = slice.map(r => ({
                title: r.title.replace(/Subtitle Indonesia|Sub Indo/gi, "").trim().slice(0, 50),
                description: `${r.status || "?"} • ⭐${r.score || "?"}`,
                id: `${prefix}anime title:${r.animeId}`
            }));

            const pgRows = [];
            if (page > 1) pgRows.push({ title: "❮ Halaman Sebelum", id: `${prefix}anime search:${qEnc}:${page - 1}` });
            if (page < maxPage) pgRows.push({ title: "Papar 10 lagi ❯", id: `${prefix}anime search:${qEnc}:${page + 1}` });

            const sections = [{ title: `୨୧ Hasil Pencarian (halaman ${page}/${maxPage})`, rows }];
            if (pgRows.length) sections.push({ title: "୨୧ Navigasi", rows: pgRows });

            return await ctx.reply({
                text: fmtHeader("𝑯𝒂𝒔𝒊𝒍 𝑺𝒆𝒂𝒓𝒄𝒉") +
                    `❖ Kata kunci: ${ctx.format.inlineCode(query)}\n` +
                    `❖ Ditemui: ${results.length} anime | halaman ${page}/${maxPage}\n\n` +
                    "✦ Pilih judul dari senarai untuk lihat episode! ♡",
                optionText: "♡ Pilih Anime",
                optionTitle: "୨୧ Hasil Pencarian",
                nativeFlow: [{ text: "♡ Pilih Anime", sections }]
            });
        }

        // ---------- /anime search:<b64query>:<page> ----------
        if (input.startsWith("search:")) {
            const m = input.slice(7).match(/^(.+):(\d+)$/);
            if (!m) return await ctx.reply(ctx.format.info("(╥﹏╥) Format carian tak sah."));
            try {
                const query = decodeQuery(m[1]);
                return await renderSearchPage(query, parseInt(m[2], 10));
            } catch (e) {
                return await ctx.reply(ctx.format.info(`(╥﹏╥) Pencarian gagal: ${String(e.message).slice(0, 150)}`));
            }
        }

        // ---------- /anime watch:<episodeId> ----------
        if (input.startsWith("watch:")) {
            const episodeId = input.slice(6).trim();
            try {
                const ep = await anime.episode(episodeId);
                const cleanTitle = ep.title.replace(/Subtitle Indonesia/gi, "").trim();

                const byQuality = {};
                for (const s of ep.servers) {
                    (byQuality[s.quality] ||= []).push(s.name);
                }

                const sections = [];
                for (const [quality, names] of Object.entries(byQuality)) {
                    sections.push({
                        title: `୨୧ ${quality}`,
                        rows: names.slice(0, 4).map(name => ({
                            title: `❖ ${name}`,
                            description: `Stream ${quality} dari pelayan ${name}`,
                            id: `${prefix}anime get:${episodeId}:${quality}:${name}`
                        }))
                    });
                }
                if (!sections.length) {
                    return await ctx.reply(ctx.format.info("(╥﹏╥) Tiada server streaming untuk episode ni..."));
                }

                return await ctx.reply({
                    text: fmtHeader("🎬 PILIH KUALITI") +
                        `❖ ${cleanTitle}\n\n` +
                        `✦ Pilih kualiti + server. Kalau satu down, bot cuba link download terus dulu, ` +
                        `pastu pelayan lain — tak akan diam² je, akan bagitahu progress.\n` +
                        `✦ Nanti dapat LINK terus (tak perlu tunggu upload ke WhatsApp).`,
                    optionText: "♡ Pilih Kualiti",
                    optionTitle: "୨୧ Kualiti & Server",
                    nativeFlow: [{ text: "♡ Pilih Kualiti & Server", sections }]
                });
            } catch (e) {
                return await ctx.reply(ctx.format.info(`(╥﹏╥) Gagal ambil episode: ${String(e.message).slice(0, 150)}`));
            }
        }

        // ---------- /anime get:<episodeId>:<quality>:<server> ----------
        if (input.startsWith("get:")) {
            const [episodeId, quality, serverName] = input.slice(4).split(":");
            try {
                await ctx.reply({
                    text: `(｡･ω･｡) Cari & proses ${quality} (${serverName})...\n` +
                        `(biasanya 30s-3min. Bot cuba link download langsung dulu, ` +
                        `kalau tiada baru cuba pelayan streaming — boleh sampai ~8min worst case, tapi mesti settle.)`
                });

                // Ping progress on the fallback walk without spamming — one message
                // per candidate switch, throttled to at most every ~20s.
                let lastPing = 0;
                const onProgress = (info) => {
                    if (info.index === 0) return; // first attempt already covered by the message above
                    if (info.elapsedMs - lastPing < PROGRESS_PING_INTERVAL_MS) return;
                    lastPing = info.elapsedMs;
                    ctx.reply({ text: `(｡•ᵕ•｡) Pelayan sebelum tu tak jadi, cuba ${info.name} (${info.quality}) — cubaan ${info.index + 1}/${info.total}...` }).catch(() => {});
                };

                let v;
                try {
                    v = await anime.resolveQuality(episodeId, quality, serverName, onProgress);
                } catch (e1) {
                    return await ctx.reply(
                        `(╥﹏╥) Semua pelayan untuk episode ni gagal buat masa ni:\n\n${String(e1.message).slice(0, 600)}\n\n` +
                        `✦ Cuba lagi sekejap lagi, ke pilih episode lain.`
                    );
                }

                const ep = await anime.episode(episodeId).catch(() => null);
                const cleanTitle = ep ? ep.title.replace(/Subtitle Indonesia/gi, "").trim() : "Anime";
                const fallbackNote = v.usedFallback
                    ? `\n✦ Nota: pelayan ${serverName} down/tiada, bot auto tukar ke ${v.source} (${v.quality}).`
                    : "";

                let hosted;
                try {
                    hosted = await anime.uploadToCdn(v.buffer, `${episodeId}-${v.quality}.mp4`);
                } catch (eUpload) {
                    // CDN upload failed — fall back to sending the raw video over
                    // WhatsApp directly rather than losing the download entirely.
                    const nav = [];
                    if (ep?.prevEpisodeId) nav.push({ text: "❮ Ep Sebelum", id: `${prefix}anime watch:${ep.prevEpisodeId}` });
                    if (ep?.nextEpisodeId) nav.push({ text: "Ep Seterusnya ❯", id: `${prefix}anime watch:${ep.nextEpisodeId}` });
                    return await ctx.reply({
                        video: v.buffer,
                        caption: `❖ ${cleanTitle}\n✦ ${v.quality} • Sumber: Sanka/${v.source}${fallbackNote}\n\n` +
                            `⚠ Upload ke CDN gagal (${String(eUpload.message).slice(0, 80)}), so ni video terus.`,
                        buttons: nav.length ? nav : undefined
                    });
                }

                const nav = [];
                if (ep?.prevEpisodeId) nav.push({ text: "❮ Ep Sebelum", id: `${prefix}anime watch:${ep.prevEpisodeId}` });
                if (ep?.nextEpisodeId) nav.push({ text: "Ep Seterusnya ❯", id: `${prefix}anime watch:${ep.nextEpisodeId}` });

                return await ctx.reply({
                    text: fmtHeader("🎬 SIAP!") +
                        `❖ ${cleanTitle}\n` +
                        `✦ ${v.quality} • Sumber: Sanka/${v.source}${fallbackNote}\n\n` +
                        `▶ Tonton di sini:\n${hosted.url}\n\n` +
                        `${nav.length ? "✦ Butang di bawah untuk pindah episode!" : ""}`,
                    buttons: nav.length ? nav : undefined
                });
            } catch (e) {
                return await ctx.reply(ctx.format.info(`(╥﹏╥) Gagal: ${String(e.message).slice(0, 150)}`));
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
                    nativeFlow: [{ text: "♡ Pilih Episode", sections }]
                });
            } catch (e) {
                return await ctx.reply(ctx.format.info(`(╥﹏╥) ${String(e.message).slice(0, 150)}`));
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
                return await ctx.reply(ctx.format.info(`(╥﹏╥) ${String(e.message).slice(0, 150)}`));
            }
        }

        // ---------- /anime <query> — SEARCH, page 1 ----------
        try {
            return await renderSearchPage(input, 1);
        } catch (e) {
            return await ctx.reply(ctx.format.info(`(╥﹏╥) Pencarian gagal: ${String(e.message).slice(0, 150)}`));
        }
    }
};
                                              
