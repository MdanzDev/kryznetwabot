module.exports = {
    name: "menu",
    aliases: ["allmenu", "help"],
    category: "main",

    code: async (ctx) => {
        try {
            const { cmd } = ctx.bot;

            // ╭──────────────୨୧
            // │ MENU CATEGORIES
            // ╰──────────────୨୧

            const categories = {
                ai: "Artificial Intelligence",
                converter: "Converter",
                downloader: "Downloader",
                game: "Game",
                group: "Group",
                maker: "Maker",
                profile: "Profile",
                search: "Search",
                tool: "Tool",
                owner: "Owner",
                information: "Information",
                misc: "Miscellaneous"
            };

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
                    "│\n" +
                    "│ (｡•̀ᴗ-)✧ Have fun using the bot!\n" +
                    "╰───────────────୨୧";

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

                    buttons: [
                        {
                            text: "♡ Hubungi Owner",
                            id: `${ctx.used.prefix}owner`
                        },
                        {
                            text: "୨୧ Support Developer",
                            id: `${ctx.used.prefix}donate`
                        }
                    ]
                });

                return;
            }

            // ╭────────────────────────୨୧
            // │ MAIN MENU
            // ╰────────────────────────୨୧

            const userDb = ctx.db.user;

            const groups = Object.values(
                await ctx.core.groupFetchAllParticipating()
            ).filter(
                group =>
                    !group.announce &&
                    !group.isCommunity &&
                    !group.isCommunityAnnounce
            );

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
                `┊ ♡ Library  › Baileys (${ctx.helper.getBaileysVersion()})\n` +
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
                "│\n" +
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
        }
    }
};