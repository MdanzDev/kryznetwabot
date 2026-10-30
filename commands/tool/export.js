// export.js — let a user take their own conversation out of the bot.
//
// Everything else about this bot is write-only from the user's side: Alya
// accumulates memories and summaries and there is no way out. This returns a
// plain text transcript of what the bot has stored for that chat, sent as a
// document so it does not flood the conversation.
"use strict";

const digits = (j = "") => String(j).split("@")[0].split(":")[0].replace(/\D/g, "");

function chatIdFor(ctx) {
    const tg = ctx.bot?.waAlya?.tg;
    if (ctx.sender.isOwner()) return String(tg?.config?.ownerIds?.[0] || "wa_owner");
    if (ctx.isGroup()) return "wag_" + ctx.id;
    return "wa_" + (digits(ctx.sender.jid) || digits(ctx.sender.lid) || "unknown");
}

const iso = (ms) => (ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 19) : "-");

module.exports = {
    name: "export",
    aliases: ["eksport"],
    category: "tool",
    description: "Eksport memori + ringkasan chat ni sebagai fail teks",
    cooldown: 30,
    code: async (ctx) => {
        const wa = ctx.bot?.waAlya;
        const tg = wa?.tg;
        if (!tg?.memory || !tg?.store)
            return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Memori/store tak aktif."));

        const chatId = chatIdFor(ctx);
        const label = ctx.sender.isOwner() ? "owner" : ctx.isGroup() ? "group" : "dm";

        let memories = [], summaries = [];
        try {
            memories = tg.memory.list(chatId) || [];
            summaries = tg.store.recentSummaries(chatId, 50) || [];
        } catch (e) {
            return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Gagal baca data: ${e.message}`));
        }

        const lines = [];
        lines.push("Alya — data yang disimpan");
        lines.push("=".repeat(40));
        lines.push(`Namespace : ${chatId}`);
        lines.push(`Jenis     : ${label}`);
        lines.push(`Dijana    : ${iso(Date.now())} UTC`);
        lines.push(`Memori    : ${memories.length}`);
        lines.push(`Ringkasan : ${summaries.length}`);
        lines.push("");
        lines.push("--- MEMORI (fakta jangka panjang) ---");
        if (!memories.length) lines.push("(tiada)");
        memories.forEach((m, i) => {
            lines.push(`${i + 1}. [${iso(m.at)}] ${m.fact}`);
        });
        lines.push("");
        lines.push("--- RINGKASAN PERBUALAN ---");
        if (!summaries.length) lines.push("(tiada)");
        summaries.forEach((s, i) => {
            lines.push(`#${i + 1} [${iso(s.created_at)}]`);
            lines.push(String(s.summary));
            lines.push("");
        });

        const body = Buffer.from(lines.join("\n"), "utf8");
        if (body.length > 15 * 1024 * 1024)
            return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Data terlalu besar untuk dihantar."));

        await ctx.reply({
            document: body,
            mimetype: "text/plain",
            fileName: `alya-export-${label}-${Date.now()}.txt`,
            caption: ctx.format.info(
                `❖ Eksport siap\n\n♡ ${memories.length} memori · ${summaries.length} ringkasan\n` +
                `♡ ${(body.length / 1024).toFixed(1)} KB`
            )
        });
    }
};
