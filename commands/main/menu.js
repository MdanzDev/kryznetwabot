const help = require("../../lib/help");

module.exports = {
    name: "menu",
    // NOTE: "help" intentionally removed from this list — it is its own command
    // now (commands/main/help.js). Two commands sharing a token both execute
    // (handler.js does matched.forEach), which would double-send the menu.
    aliases: ["allmenu"],
    category: "main",

    code: async (ctx) => {
        const menuTimeout = setTimeout(() => {
            console.error("[MENU ERROR] command timed out after 20s");
            ctx.reply({ text: "Menu loading lambat... cuba lagi sebentar ya~" }).catch(() => {});
        }, 20000);
        try {
            const { cmd } = ctx.bot;

            // ╭───────────────୨୧
            // │ MENU CATEGORIES
            // ╰───────────────୨୧

            const categories = help.CATEGORY_LABELS;

            // Get commands from selected categories
            const getCommands = (selectedCategories) => {
                const result = {};
                const allCommands = Array.from(cmd.values());

                for (const category of selectedCategories) {
                    const commands = allCommands
                        .filter(command => command.category === category)
                        .map(command => ({
                            name: command.name,
                            permissions: command.permissions || {}
                        }))
                        .sort((a, b) =>
                            a.name.localeCompare(b.name)
                        );

                    if (commands.length > 0) {
                        result[category] = commands;
                    }
                }

                return result;
            };

            // Permission symbols
            const formatPerms = (permissions = {}) => {
                let result = "";

                if (permissions.coin) result += " ⓒ";
                if (permissions.group) result += " Ⓖ";
                if (permissions.owner) result += " Ⓞ";
                if (permissions.premium) result += " Ⓟ";
                if (permissions.private) result += " ⓟ";

                return result;
            };

            const input = ctx.args[0]?.toLowerCase();
            const isAllMenu = ctx.used.command === "allmenu";

            // ╭────────────────────────୨୧
            // │ CATEGORY / ALL MENU
            // ╰────────────────────────୨୧

            if (input || isAllMenu) {
                const selectedCategories =
                    input === "all" || isAllMenu
                        ? Object.keys(categories)
                        : categories[input]
                            ? [input]
                            : [];

                const commandsData =
                    getCommands(selectedCategories);

                if (Object.keys(commandsData).length === 0) {
                    return await ctx.reply(
                        ctx.format.info(
                            "(｡•́︿•̀｡) Menu yang kamu cari tidak ditemukan..."
                        )
                    );
                }

                let text =
                    "╭───────────────୨୧\n" +
                    "│  ₊˚⊹♡  𝑴𝒆𝒏𝒖  ♡⊹˚₊\n" +
                    "│  (｡･ω･｡)ﾉ♡ Here are my commands!\n" +
                    "╰───────────────୨୧\n\n";

                for (const [category, commands] of Object.entries(commandsData)) {
                    text +=
                        "╭┈┈┈┈┈┈┈┈୨୧\n" +
                        `┊ ✦ ${ctx.format.bold(
                            categories[category] || category
                        )}\n` +
                        "┊\n";

                    for (const command of commands) {
                        text +=
                            `┊ ❖ ${ctx.used.prefix}${command.name}` +
                            `${formatPerms(command.permissions)}\n`;
                        // Plain-language line so the menu teaches instead of
                        // just listing names (that was the old dead end).
                        const what = help.entry(command.name)?.what;
                        if (what) text += `┊    ♡ ${what}\n`;
                    }

                    text +=
                        "╰┈┈┈┈┈┈┈┈୨୧\n\n";
                }

                text +=
                    "╭───────────────୨୧\n" +
                    "│ ♡ 𝑷𝒆𝒓𝒎𝒊𝒔𝒔𝒊𝒐𝒏 𝑲𝒆𝒚 ♡\n" +
                    "│ ⓒ Coin\n" +
                    "│ Ⓖ Group\n" +
                    "│ Ⓞ Owner\n" +
                    "│ Ⓟ Premium\n" +
                    "│ ⓟ Private\n" +
                    "│ 🛡️ Admin grup\n" +
                    "│\n" +
                    `│ ♡ Detail: ${ctx.used.prefix}help <perintah>\n` +
                    "│ (｡•̀ᴗ-)✧ Have fun using the bot!\n" +
                    "╰───────────────୨୧";

                // Keep the category picker alive in the category view too —
                // before this, `.menu group` was a dead end (text only, no way
                // back to the other categories without retyping the command).
                const allNames = Object.values(commandsData).flat().map(c => c.name);

                await ctx.reply({
                    caption: text,

                    location: {
                        degreesLatitude: 0,
                        degreesLongitude: 0,
                        name: config.bot.name,
                        address:
                            "♡ Jangan lupa support developer kecil ini ya! ♡",
                        jpegThumbnail:
                            await ctx.helper.getJpegThumbnail(
                                config.bot.thumbnail
                            )
                    },

                    footer: config.msg.footer,
                    optionText: "♡ Menu Selection",
                    optionTitle: "୨୧ Pilih Opsi",

                    nativeFlow: [
                        {
                            text: "♡ Pilih Kategori",
                            sections: [{
                                title: "୨୧ Kategori Perintah",
                                highlight_label: "♡",
                                rows: help.categoryRows(ctx)
                            }]
                        },
                        // Jump straight to a command's detail card from the list
                        // that was just shown.
                        ...(allNames.length && allNames.length <= 30
                            ? [{
                                text: "♡ Detail Perintah",
                                sections: [{
                                    title: "୨୧ Pilih Perintah",
                                    rows: allNames.slice(0, 10).map(n => ({
                                        title: `❖ ${ctx.used.prefix}${n}`,
                                        description: `୨୧ ${(help.entry(n)?.what || "").slice(0, 50)}`,
                                        id: `${ctx.used.prefix}help ${n}`
                                    }))
                                }]
                            }]
                            : []),
                        { text: "୨୧ Hubungi Owner", id: `${ctx.used.prefix}owner` },
                        { text: "♡ Donasi", id: `${ctx.used.prefix}donate` }
                    ]
                });

                return;
            }

            // ╭────────────────────────୨୧
            // │ MAIN MENU
            // ╰────────────────────────୨୧

            const userDb = ctx.db.user;

            let groups = [];
            try {
                groups = Object.values(
                    await Promise.race([
                        ctx.core.groupFetchAllParticipating(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("groupFetch timeout")), 15000))
                    ])
                ).filter(
                    group =>
                        !group.announce &&
                        !group.isCommunity &&
                        !group.isCommunityAnnounce
                );
            } catch {
                // WA connection unstable — continue with empty groups list
            }

            // User status
            let status;

            if (ctx.sender.isOwner()) {
                status = "Owner ♡";
            } else if (userDb?.premium) {
                status = userDb?.premiumExpiration
                    ? `Premium ♡ (${ctx.format.convertMsToDuration(
                        userDb.premiumExpiration - Date.now(),
                        ["hari", "jam"]
                    )} tersisa)`
                    : "Premium ♡ (Selamanya)";
            } else {
                status = "Freemium";
            }

            const text =
                "╭───────────────୨୧\n" +
                "│  ₊˚⊹♡  𝑯𝒆𝒍𝒍𝒐 𝑻𝒉𝒆𝒓𝒆!  ♡⊹˚₊\n" +
                `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა  @${ctx.getId(
                    ctx.sender.lid
                )}\n` +
                `│ ♡ I'm ${config.bot.name}!\n` +
                "│ Your little WhatsApp assistant ♡\n" +
                "╰───────────────୨୧\n" +

                "\n" +

                "╭┈┈┈┈┈┈┈┈୨୧\n" +
                "┊ ✦ 𝑷𝒓𝒐𝒇𝒊𝒍𝒆 ୨୧\n" +
                `┊ ♡ Status › ${status}\n` +
                `┊ ♡ Level  › ${userDb?.level || 0} (${userDb?.xp || 0}/100)\n` +
                `┊ ♡ Coins  › ${
                    ctx.sender.isOwner() || userDb?.premium
                        ? "Unlimited ♡"
                        : userDb?.coin || 0
                }\n` +
                "╰┈┈┈┈┈┈┈┈୨୧\n" +

                "\n" +

                "╭┈┈┈┈┈┈┈┈୨୧\n" +
                "┊ ✦ 𝑺𝒚𝒔𝒕𝒆𝒎 ୨୧\n" +
                `┊ ♡ Mode     › ${ctx.format.ucwords(
                    ctx.db.bot?.mode || "public"
                )}\n` +
                `┊ ♡ Uptime   › ${
                    ctx.me?.readyAt
                        ? ctx.format.convertMsToDuration(
                            Date.now() - ctx.me.readyAt
                        )
                        : "Unknown"
                }\n` +
                `┊ ♡ Users    › ${ctx.db.users.totalEntries}\n` +
                `┊ ♡ Groups   › ${ctx.db.groups.totalEntries}/${groups.length}\n` +
                "╰┈┈┈┈┈┈┈┈୨୧\n" +

                "\n" +

                "╭───────────────୨୧\n" +
                "│ ₊˚⊹♡  𝑾𝒉𝒂𝒕 𝒘𝒊𝒍𝒍 𝒊𝒕 𝒃𝒆?  ♡⊹˚₊\n" +
                "│\n" +
                "│ ૮₍ ˶ᵔ ᵕ ᵔ˶ ₎ა Choose a menu below!\n" +
                "│\n" +
                "│ (｡•̀ᴗ-)✧ Explore my commands!\n" +
                "│ (づ｡◕‿‿◕｡)づ Have fun!\n" +
                "╰───────────────୨୧\n" +

                "\n" +

                "╭───────────────୨୧\n" +
                "│ ♡ 𝑴𝒚 𝑫𝒆𝒗𝒆𝒍𝒐𝒑𝒆𝒓\n" +
                "│\n" +
                "│ ✦ GitHub › github.com/MdanzDev\n" +
                "│ ♡ Thank you for using my bot!\n" +
                "│ 𝒀𝒐𝒖𝒓 𝒔𝒖𝒑𝒑𝒐𝒓𝒕 𝒎𝒆𝒂𝒏𝒔 𝒂 𝒍𝒐𝒕 ♡\n" +
                "╰───────────────୨୧";

            // ╭────────────────────────୨୧
            // │ MENU DROPDOWN
            // ╰────────────────────────୨୧

            const rows = Object.entries(categories).map(
                ([category, name]) => ({
                    title: `♡ ${name}`,
                    description: `୨୧ Lihat perintah ${name}`,
                    id: `${ctx.used.prefix}${ctx.used.command} ${category}`
                })
            );

            rows.unshift({
                title: "♡ Semua Kategori",
                description: "୨୧ Lihat semua perintah sekaligus",
                id: `${ctx.used.prefix}${ctx.used.command} all`
            });

            // New users don't know the command names, so give them the
            // quick-start guide right in the picker.
            rows.unshift({
                title: "♡ Panduan Mula",
                description: "୨୧ Baru guna bot? Baca ni dulu",
                id: `${ctx.used.prefix}help`
            });

            // ╭────────────────────────୨୧
            // │ SEND MAIN MENU
            // ╰────────────────────────୨୧

            await ctx.reply({
                image: {
                    url: config.bot.thumbnail
                },

                caption: text,

                mentions: [
                    ctx.sender.lid
                ],

                footer: config.msg.footer,

                optionText: "♡ Menu Selection",
                optionTitle: "୨୧ Pilih Opsi",

                nativeFlow: [
                    {
                        text: "♡ Daftar Menu",

                        sections: [
                            {
                                title: "୨୧ Pilih Kategori Menu",
                                highlight_label: "♡",
                                rows
                            }
                        ]
                    },

                    {
                        text: "♡ GitHub",
                        url: "https://github.com/MdanzDev/"
                    },

                    {
                        text: "୨୧ Hubungi Owner",
                        id: `${ctx.used.prefix}owner`
                    },

                    {
                        text: "♡ Donasi",
                        id: `${ctx.used.prefix}donate`
                    }
                ]
            });

        } catch (error) {
            console.error("[MENU ERROR]", error);

            await ctx.helper.handleError(
                ctx,
                error
            );
        } finally {
            clearTimeout(menuTimeout);
        }
    }
};