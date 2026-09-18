const anime = require("../../lib/anime.js");

// /anime <query>        — search
// /anime title:<slug>   — show seasons/episodes of that title
// /anime eps:<slug>:<page> — episode list (paginated, 8 per page)
// /anime watch:<episodeId> — stream/download an episode
// /anime next:<episodeId> / prev:<episodeId> — navigation from a watch card

const EPS_PER_PAGE = 8;

function fmtHeader(title) {
    return "╭───────────────୨୧\n" +
           `│  ₊˚⊹♡  ${title}  ♡⊹˚₊\n` +
           "╰───────────────୨୧\n\n";
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

                // Try to extract the direct mp4 from the stream page
                const mp4 = ep.defaultStreamingUrl ? await anime.extractMp4(ep.defaultStreamingUrl) : null;

                // Navigation buttons
                const nav = [];
                if (ep.prevEpisodeId) nav.push({ text: "❮ Ep Sebelum", id: `${prefix}anime watch:${ep.prevEpisodeId}` });
                if (ep.nextEpisodeId) nav.push({ text: "Ep Seterusnya ❯", id: `${prefix}anime watch:${ep.nextEpisodeId}` });
                const buttons = nav.length ? [nav] : [];
                // quality download links (URL buttons — open in browser)
                for (const q of ep.download.slice(0, 2)) {
                    const host = q.urls?.[0];
                    if (host) buttons.push([{ text: `⬇ ${q.quality}${q.size ? " (" + q.size.trim() + ")" : ""}`, url: host.url }]);
                }

                if (mp4) {
                    // Direct video — WhatsApp/Telegram fetch it themselves
                    await ctx.reply({
                        video: { url: mp4 },
                        caption: `❖ ${ep.title.replace(/Subtitle Indonesia/gi, "").trim()}\n\n${nav.length ? "▶ Gunakan butang di bawah untuk pindah episode!" : ""}`,
                        buttons: buttons.length ? buttons : undefined
                    });
                    return;
                }

                // Fallback: text card with buttons
                let text = fmtHeader("🎬 TONTON EPISODE") +
                    `❖ ${ep.title}\n\n`;
                if (ep.download.length) text += "✦ Pilih kualiti download di bawah ya~\n";
                else if (ep.defaultStreamingUrl) text += "✦ Klik 'Tonton Online' untuk stream!\n";
                if (ep.servers.length) text += `✦ Server: ${[...new Set(ep.servers.map(s => s.name))].join(", ")}\n`;
                if (!buttons.find(b => b.some(x => x.url)) && ep.defaultStreamingUrl)
                    buttons.push([{ text: "▶ Tonton Online", url: ep.defaultStreamingUrl }]);

                return await ctx.reply({
                    text,
                    buttons: buttons.length ? buttons : undefined
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

                let text = fmtHeader(d.title.slice(0, 40)) +
                    `✦ Status  › ${d.status || "?"}\n` +
                    `✦ Episode › ${total} total | halaman ${page}/${maxPage}\n` +
                    (d.score ? `✦ Skor    › ${d.score}\n` : "") +
                    `\n╭┈┈┈┈┈┈┈┈୨୧\n`;

                const buttons = slice.map(e => [{
                    text: `❖ Episode ${e.eps}`,
                    id: `${prefix}anime watch:${e.episodeId}`
                }]);

                // pagination
                const pg = [];
                if (page < maxPage) pg.push({ text: "Seterusnya ❯", id: `${prefix}anime eps:${slug}:${page + 1}` });
                if (pg.length) buttons.push(pg);

                return await ctx.reply({ text, buttons });
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
                    `❖ Sinopsis:\n${(d.synopsis || "-").slice(0, 300)}...\n`;
                return await ctx.reply({
                    ...(d.poster ? { image: { url: d.poster }, caption: fmtHeader(d.title.slice(0, 45)) + info } : { text: fmtHeader(d.title.slice(0, 45)) + info }),
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

            let text = fmtHeader("𝑯𝒂𝒔𝒊𝒍 𝑺𝒆𝒂𝒓𝒄𝒉") +
                `❖ Kata kunci: ${ctx.format.inlineCode(input)}\n` +
                `❖ Ditemui: ${results.length} anime\n\n` +
                "✦ Pilih judul di bawah untuk lihat episode! ♡\n";

            const buttons = results.slice(0, 8).map(r => [{
                text: `❖ ${r.title.replace(/Subtitle Indonesia|Sub Indo/gi, "").trim().slice(0, 45)}`,
                id: `${prefix}anime title:${r.animeId}`
            }]);

            return await ctx.reply({ text, buttons });
        } catch (e) {
            return await ctx.reply(ctx.format.info(`(╥﹏╥) Pencarian gagal: ${String(e.message).slice(0, 100)}`));
        }
    }
};
