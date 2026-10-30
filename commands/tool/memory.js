// memory.js — let a user see and delete what Alya remembers about them.
//
// The bot stores long-term facts in database/alya.db (130 rows at time of
// writing) and until now there was no way to read or remove them. That is a
// privacy hole and also just annoying: Alya sometimes remembers the wrong thing
// forever.
//
// Namespace must match wa-bridge.js exactly:
//   owner  -> tg ownerIds[0]        (shared brain with Telegram)
//   group  -> "wag_" + group jid
//   DM     -> "wa_"  + sender digits
"use strict";

const digits = (j = "") => String(j).split("@")[0].split(":")[0].replace(/\D/g, "");

function namespaceFor(ctx) {
    if (ctx.sender.isOwner()) return "owner";
    if (ctx.isGroup()) return "group";
    return "dm";
}

function chatIdFor(ctx, ns) {
    const tg = ctx.bot?.waAlya?.tg;
    if (ns === "owner") return String(tg?.config?.ownerIds?.[0] || "wa_owner");
    if (ns === "group") return "wag_" + ctx.id;
    return "wa_" + (digits(ctx.sender.jid) || digits(ctx.sender.lid) || "unknown");
}

module.exports = {
    name: "memory",
    aliases: ["memori", "ingatan"],
    category: "tool",
    description: "Lihat / padam apa yang Alya ingat pasal kau",
    cooldown: 3,
    code: async (ctx) => {
        const wa = ctx.bot?.waAlya;
        const memory = wa?.tg?.memory;
        if (!memory) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Memori tak aktif."));

        const ns = namespaceFor(ctx);
        const chatId = chatIdFor(ctx, ns);
        const p = ctx.used?.prefix || ".";
        const input = String(ctx.text || "").trim();

        // .memory del <n> | .memory clear
        const del = input.match(/^(?:del|delete|hapus|buang)\s+(\d+)$/i);
        if (del) {
            const idx = parseInt(del[1], 10) - 1;
            const ok = memory.forget(chatId, idx);
            return await ctx.reply(ctx.format.info(ok
                ? "(｡･ω･｡) Dah lupa perkara tu."
                : "(｡•́︿•̀｡) Nombor tu tak ada dalam senarai."));
        }
        if (/^(?:clear|reset|kosongkan)$/i.test(input)) {
            memory.clear(chatId);
            return await ctx.reply(ctx.format.info("(｡･ω･｡) Semua memori aku pasal chat ni dah dipadam."));
        }

        const facts = memory.list(chatId) || [];
        if (!facts.length) {
            return await ctx.reply(ctx.format.info(
                `(｡･ω･｡) Aku belum ingat apa-apa pasal ${ns === "group" ? "grup ni" : "kau"}.\n\n` +
                `♡ Aku belajar bila kau cakap pasal diri kau, atau guna ${p}kryzz "ingat ..."`
            ));
        }

        const shown = facts.slice(0, 20);
        const lines = shown.map((f, i) => `♡ ${i + 1}. ${String(f.fact).slice(0, 120)}`);
        const more = facts.length > shown.length
            ? `\n\n… dan ${facts.length - shown.length} lagi (tak dipaparkan)`
            : "";

        return await ctx.reply(ctx.format.info(
            `❖ *Memori Alya* (${facts.length}) — ${ns === "group" ? "grup ni" : ns === "owner" ? "owner" : "kau"}\n\n` +
            lines.join("\n") + more +
            `\n\n♡ Padam satu: ${p}memory del <n>` +
            `\n♡ Padam semua: ${p}memory clear`
        ));
    }
};
