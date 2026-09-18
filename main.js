const config = require("./config.json");
const { Client, CommandHandler } = require("./lib");
const path = require("node:path");
const util = require("node:util");

const Events = require("./events");
const Middlewares = require("./middlewares");

const {
    bot: botConfig,
    system
} = config;
const directory = {
    auth: path.resolve(__dirname, "state"),
    database: path.resolve(__dirname, "database"),
    command: path.resolve(__dirname, "commands")
};

console.log("[*] Connecting...");

const parsePrefix = function(prefix) {
    if (typeof prefix !== "string") return prefix;
    const match = prefix.match(/(\/?)(.+)\1([a-z]*)/i);
    if (!match) return prefix;
    const validFlags = Array.from(new Set(match[3])).filter(flag => "gimsuy".includes(flag)).join("");
    try {
        return new RegExp(match[2], validFlags);
    } catch {
        return prefix;
    }
};

const bot = new Client({
    auth: {
        dir: directory.auth,
        phoneNumber: botConfig.phoneNumber,
        usePairingCode: system.usePairingCode,
        customPairingCode: system.customPairingCode,
        useStore: system.useStore
    },
    connection: {
        version: system?.WAVersion,
        alwaysOnline: system.alwaysOnline,
        selfReply: system.selfReply,
        loggerLevel: system?.loggerLevel
    },
    messaging: {
        autoRead: system.autoRead,
        prefix: parsePrefix(botConfig?.prefix)
    },
    database: {
        dir: directory.database,
        defaults: {
            users: {
                pushName: "Unknown",
                coin: 100,
                level: 0,
                xp: 0,
                winGame: 0,
                premium: false,
                premiumExpiration: null,
                banned: false,
                afk: {},
                lastClaim: {},
                sessionId: {},
                lastSentMsg: {},
                botGroupMembership: {},
                autodownload: false
            },
            groups: {
                members: [],
                mute: [],
                warnings: [],
                maxwarnings: 3,
                mutebot: false,
                option: {},
                text: {},
                sewa: false,
                sewaExpiration: null,
                spam: []
            },
            bot: {
                mode: "public",
                restart: {},
                text: {},
                blacklistBroadcast: [],
                lastPrefix: "/"
            }
        }
    },
    owner: [config.owner.id, ...config.owner.co.map(co => co.id)].filter(Boolean)
});

Events(bot);
Middlewares(bot);

const cmd = new CommandHandler(bot, directory.command);
cmd.load();

bot.launch().catch(error => console.error(util.styleText("red", "[x]"), `Error: ${util.format(error)}`));

if (config.telegram?.enabled && config.telegram?.token) {
    const { TelegramBot } = require("./lib/telegram");
    const tgBot = new TelegramBot(bot, config.telegram);
    tgBot.start().catch(error => console.error(util.styleText("red", "[x]"), `Telegram error: ${util.format(error)}`));
    // Alya on WhatsApp — same brain as Telegram (mood, memory, humanizer)
    if (config.telegram?.waAlya?.enabled !== false) {
        const { WaAlya } = require("./lib/telegram/wa-bridge");
        bot.waAlya = new WaAlya(tgBot);
        console.log(util.styleText("magenta", "[~]"), "Alya WhatsApp bridge armed (private: always, group: tag/reply only)");
    }
}