// Command: help — the discovery layer.
//
// Three jobs:
//   1. `.help`                -> quick-start card (what new users actually need)
//   2. `.help <command>`      -> full card: what it does, usage, aliases, sub-options
//   3. `.help <other-bot name>` -> "you probably mean X" for muscle-memory names
//      from other bots (.close, .setwelcome, .antilink...) which are NOT real
//      commands here.
//
// Why this exists: 43 of this bot's commands have no alias, and every usage
// template lives inside the command itself — reachable only after you already
// know the name. Users arriving with habits from other bots got silence
// (didyoumean has no candidate near "close"). This command answers them.
const help = require("../../lib/help");

module.exports = {
    name: "help",
    aliases: ["panduan", "bantuan", "howto", "cara"],
    category: "main",
    code: async (ctx) => {
        const p = ctx.used.prefix;
        const input = (ctx.text || "").trim().toLowerCase().replace(/^[/!.#]/, "");

        // ---- `.help` with no argument: quick start ----
        if (!input) {
            return await ctx.reply({
                text: help.quickStart(ctx),
                footer: config.msg.footer,
                optionText: "♡ Panduan",
                optionTitle: "୨୧ Bantuan",
                nativeFlow: [
                    {
                        text: "♡ Pilih Kategori",
                        sections: [{
                            title: "୨୧ Kategori Perintah",
                            highlight_label: "♡",
                            rows: help.categoryRows(ctx, [{
                                title: "♡ Senarai Semua",
                                description: "୨୧ Semua perintah sekali gus",
                                id: `${p}menu all`
                            }])
                        }]
                    },
                    { text: "♡ Buka Menu", id: `${p}menu` },
                    { text: "୨୧ Hubungi Owner", id: `${p}owner` }
                ]
            });
        }

        // ---- `.help <command>` / `.help <other-bot name>` ----
        const hit = help.resolveToken(input);
        if (!hit) {
            return await ctx.reply({
                text: `${ctx.format.info(`(｡•́︿•̀｡) Aku tak kenal perintah ${ctx.format.inlineCode(p + input)}.`)}\n\n` +
                    `(｡･ω･｡) Ketik ${ctx.format.inlineCode(p + "menu")} untuk senarai penuh, ` +
                    `atau ${ctx.format.inlineCode(p + "help")} untuk panduan mula.`,
                buttons: [
                    { text: "♡ Buka Menu", id: `${p}menu` },
                    { text: "୨୧ Panduan", id: `${p}help` }
                ]
            });
        }

        // Resolved to a real command (possibly via another bot's naming).
        const target = hit.command;

        // Dispatcher with a specific sub-command: `.help close` -> group close card
        if (hit.sub) {
            const card = help.subCard(ctx, target, hit.sub);
            if (card) {
                return await ctx.reply({
                    text: card,
                    footer: config.msg.footer,
                    buttons: [
                        { text: "♡ Guna Sekarang", id: `${p}${target} ${hit.sub}` },
                        { text: "୨୧ Semua Pilihan", id: `${p}help ${target}` }
                    ]
                });
            }
        }

        // Dispatcher with no sub given (`.help group`): show the whole family.
        if (help.SUBS[target] && hit.via !== "common") {
            return await ctx.reply({
                text: help.subCard(ctx, target),
                footer: config.msg.footer,
                buttons: [
                    { text: "♡ Lihat Status", id: `${p}${target} status` },
                    { text: "୨୧ Buka Menu", id: `${p}menu ${help.entry(target)?.category || "group"}` }
                ]
            });
        }

        // Ordinary command: full card.
        const card = help.card(ctx, target);
        if (!card) {
            return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Tiada info untuk ${ctx.format.inlineCode(target)}.`));
        }
        return await ctx.reply({
            text: card,
            footer: config.msg.footer
        });
    }
};
