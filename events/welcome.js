const moment = require("moment-timezone");

/**
 * Build a map of placeholder => value for a given welcome/leave event.
 * Supports {placeholder} and %placeholder% styles (case-insensitive).
 */
async function buildPlaceholders(bot, welcome, groupJid, participantJid, groupDb) {
    const metadata = await bot.core.groupMetadata(groupJid);

    // Try to resolve the participant's display name.
    let userName = "";
    try {
        if (typeof bot.getName === "function") {
            userName = bot.getName(participantJid) || "";
        }
        if (!userName) {
            const contact = metadata.participants?.find(
                (p) => p.id === participantJid
            );
            userName = contact?.notify || contact?.name || contact?.verifiedName || "";
        }
    } catch { /* ignore */ }
    if (!userName) userName = participantJid.split("@")[0];

    const mentionTag = `@${bot.getId(participantJid)}`;
    const now = moment().tz(config.system.timeZone);

    return {
        // Identity
        tag: mentionTag,
        mention: mentionTag,
        user: userName,
        name: userName,
        username: userName,
        sender: mentionTag,
        jid: participantJid,
        number: participantJid.split("@")[0],

        // Group
        subject: metadata.subject || "",
        group: metadata.subject || "",
        groupname: metadata.subject || "",
        description: metadata.description || "",
        desc: metadata.description || "",

        // Meta
        count: String(metadata.participants?.length ?? ""),
        members: String(metadata.participants?.length ?? ""),

        // Time / date
        time: now.format("HH:mm"),
        date: now.format("DD/MM/YYYY"),
        day: now.format("dddd"),
        datetime: now.format("dddd, DD MMMM YYYY HH:mm"),

        // Bot
        prefix: groupDb?.botPrefix || bot.db?.get?.("bot")?.lastPrefix || "/",
        botname: bot.info?.pushname || bot.info?.name || "Bot"
    };
}

/**
 * Replace every {key} and %key% (case-insensitive) found in `text`
 * with the matching value from `map`. Unknown keys are left untouched.
 */
function applyPlaceholders(text, map) {
    if (!text || typeof text !== "string") return text;

    // Lookup is case-insensitive
    const lowerMap = {};
    for (const [k, v] of Object.entries(map)) lowerMap[k.toLowerCase()] = v;

    // {key}
    let out = text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
        const v = lowerMap[key.toLowerCase()];
        return v !== undefined ? v : match;
    });

    // %key%
    out = out.replace(/%([a-zA-Z0-9_]+)%/g, (match, key) => {
        const v = lowerMap[key.toLowerCase()];
        return v !== undefined ? v : match;
    });

    return out;
}

/**
 * Detect whether the rendered text actually contains a mention token.
 * We only need to pass `mentions` if a mention was used, otherwise it's harmless.
 */
function containsMention(text, mentionTag) {
    return typeof text === "string" && text.includes(mentionTag);
}

async function WelcomeHandler(bot, welcome, type, isSimulate = false) {
    const groupJid = welcome.id;
    const groupDb = bot.getDb("groups", groupJid);
    const botDb = bot.getDb("bot");
    const participantJid = welcome.participant;

    if (!isSimulate && type === "UserJoin" && participantJid) {
        // The bot is added to the group the same way a member is, so this event
        // fires for the bot's own join. Without this check the bot welcomes
        // itself whenever welcome messages are enabled. Return before recording
        // firstSeen too — the bot is not a member to track.
        const botIds = [
            bot.core?.user?.id,
            bot.core?.user?.lid,
            bot.core?.authState?.creds?.me?.lid
        ].filter(Boolean);
        const bare = (jid) => String(jid).split("@")[0].split(":")[0];
        if (botIds.some(id => bare(id) === bare(participantJid))) return;

        // Record firstSeen on join, regardless of whether welcome messages are on.
        // lib/group-rank.js needs it to tell a brand-new member (sent: 0, do not
        // kick) apart from a long-time lurker (sent: 0, fair target for .kickidle).
        // Without this the two are indistinguishable.
        try {
            const members = groupDb?.members || [];
            const existing = members.find(m => bot.helper?.areJidsSameUser
                ? bot.helper.areJidsSameUser(m.id, participantJid)
                : m.id === participantJid);
            if (existing) {
                if (!existing.firstSeen) existing.firstSeen = Date.now();
            } else {
                members.push({ id: participantJid, sent: 0, firstSeen: Date.now() });
            }
            groupDb.members = members;
            groupDb.save();
        } catch { /* non-fatal: ranking degrades to "tiada rekod" */ }
    }

    if (!isSimulate && groupDb?.mutebot) return;
    if (!isSimulate && !groupDb?.option?.welcome) return;
    if (!isSimulate && !["group", "public"].includes(botDb?.mode || "public")) return;

    const now = moment().tz(config.system.timeZone);
    const hour = now.hour();
    if (!isSimulate && config.system.unavailableAtNight && hour >= 0 && hour < 6) return;

    const isWelcome = type === "UserJoin";
    const placeholders = await buildPlaceholders(
        bot, welcome, groupJid, participantJid, groupDb
    );

    const customText = isWelcome ? groupDb?.text?.welcome : groupDb?.text?.goodbye;

    const defaultText = isWelcome
        ? "╭───────────────✦✧\n" +
          "│  ⊰˚⊹♡  𝑾𝑬𝑳𝑪𝑶𝑴𝑬!  ♡⊹˚⊱\n" +
          "│ 「 ʚ Selamat datang {mention}!\n" +
          "│ ♡ Di grup › {group}\n" +
          "│ (｡･ω･｡)ﾉ♡ Semoga betah dan patuhi aturan ya~\n" +
          "╰───────────────✦✧"
        : "╭───────────────✦✧\n" +
          "│  ⊰˚⊹♡  𝑮𝑶𝑶𝑫𝑩𝒀𝑬~  ♡⊹˚⊱\n" +
          "│ (｡•́︿•̀｡) Selamat tinggal {mention}...\n" +
          "│ ♡ Sampai jumpa lagi di lain waktu ya!\n" +
          "╰───────────────✦✧";

    const rawText = customText || defaultText;
    const text = applyPlaceholders(rawText, placeholders);

    // Only attach mentions if the final text actually references the user.
    const shouldMention =
        containsMention(text, placeholders.mention) ||
        containsMention(text, placeholders.user) === false && text.includes("@");

    const sendPayload = {
        text,
        mentions: text.includes(placeholders.mention) ? [participantJid] : undefined
    };

    if (isWelcome) {
        sendPayload.buttons = [
            {
                text: "♡ Menu Bot",
                id: `${botDb?.lastPrefix || "/"}menu`
            },
            {
                text: "✿ Perkenalan",
                id: `${botDb?.lastPrefix || "/"}intro`
            }
        ];
    }

    await bot.sendMessage(groupJid, sendPayload);

    if (isWelcome && groupDb?.text?.intro) {
        const introText = applyPlaceholders(groupDb.text.intro, placeholders);
        await bot.sendMessage(groupJid, {
            text: introText,
            mentions: introText.includes(placeholders.mention)
                ? [participantJid]
                : undefined,
            nativeFlow: [{
                text: "♡ Salin Teks Intro",
                copy: introText
            }]
        });
    }
}

module.exports = (bot) => {
    bot.ev.on("UserJoin", async (welcome) => WelcomeHandler(bot, welcome, "UserJoin"));
    bot.ev.on("UserLeave", async (welcome) => WelcomeHandler(bot, welcome, "UserLeave"));
};

module.exports.WelcomeHandler = WelcomeHandler;
module.exports.applyPlaceholders = applyPlaceholders;
module.exports.buildPlaceholders = buildPlaceholders;