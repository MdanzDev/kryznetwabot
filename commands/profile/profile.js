const tokenLimiter = require("../../lib/telegram/token-limiter");

// ╭───────────────୨୧
// │ STYLE — edit these
// ╰───────────────୨୧
const STYLE = {
    dir: "/root/kryznetwabot/",
    headerMode: "none",
    videoFile: "hero_tiny.mp4",
    videoIsGif: false,
    fallbackImage: null,

    quoteName: "Kryz",
    quoteText: "Kryz-Net · Premium Cloud & Hosting",
    quoteVerified: true,

    enableForward: true,
    forwardScore: 5,

    enableChannel: true,
    channelInvite: "0029Vb8RP9f3bbV0ST0ZrL0X",
    channelName: "Kryz | Cloud & Hosting",
    channelServerId: 1,

    enableAdReply: false,
    adTitle: "Kryz-Net · Premium Cloud",
    adBody: "Fast VPS · Bot Hosting · 24/7 Support",
    adSourceUrl: "https://founder.kryz-net.space",
    adThumbFile: "thumb.jpg",
    adRenderLarge: false,
    adShowAttribution: false
};

// ╭───────────────୨୧
// │ STYLE HELPERS
// ╰───────────────୨୧

let _cache = null, _promise = null;

const warmStyle = (sock) => {
    if (_cache) return Promise.resolve(_cache);
    if (_promise) return _promise;

    _promise = (async () => {
        const fs = require("fs");
        const c = { videoBuffer: null, thumbBuffer: null, newsletterJid: null };

        if (STYLE.headerMode === "video") {
            try {
                const vp = STYLE.dir + STYLE.videoFile;
                if (fs.existsSync(vp)) c.videoBuffer = fs.readFileSync(vp);
            } catch (_) {}
        }

        try {
            const tp = STYLE.dir + STYLE.adThumbFile;
            if (fs.existsSync(tp)) c.thumbBuffer = fs.readFileSync(tp);
        } catch (_) {}

        if (STYLE.enableChannel) {
            try {
                const meta = await sock.newsletterMetadata("invite", STYLE.channelInvite);
                c.newsletterJid = meta?.id;
            } catch (_) {}
        }

        _cache = c;
        _promise = null;
        return c;
    })();

    return _promise;
};

const buildStyle = () => {
    const c = _cache || {};
    const stanzaId = "3EB0" + Math.random().toString(36).slice(2, 12).toUpperCase();

    const fakeMsg = {
        key: {
            id: stanzaId,
            remoteJid: "status@broadcast",
            fromMe: false,
            participant: "0@s.whatsapp.net"
        },
        message: { conversation: STYLE.quoteText },
        verifiedBizName: STYLE.quoteName,
        pushName: STYLE.quoteName
    };

    const contextInfo = {
        stanzaId,
        participant: "0@s.whatsapp.net",
        remoteJid: "status@broadcast",
        quotedMessage: { conversation: STYLE.quoteText },
        ...(STYLE.quoteVerified ? { verifiedBizName: STYLE.quoteName } : {})
    };

    if (STYLE.enableForward) {
        contextInfo.forwardingScore = STYLE.forwardScore;
        contextInfo.isForwarded = true;
    }

    if (STYLE.enableChannel && c.newsletterJid) {
        contextInfo.forwardedNewsletterMessageInfo = {
            newsletterJid: c.newsletterJid,
            newsletterName: STYLE.channelName,
            serverMessageId: STYLE.channelServerId
        };
    }

    if (STYLE.enableAdReply) {
        contextInfo.externalAdReply = {
            title: STYLE.adTitle,
            body: STYLE.adBody,
            mediaType: 1,
            sourceUrl: STYLE.adSourceUrl,
            mediaUrl: STYLE.adSourceUrl,
            renderLargerThumbnail: STYLE.adRenderLarge,
            showAdAttribution: STYLE.adShowAttribution,
            ...(c.thumbBuffer ? { thumbnail: c.thumbBuffer } : {})
        };
    }

    return { fakeMsg, contextInfo };
};

const buildHeaderMedia = () => {
    const c = _cache || {};
    const fallback = { image: { url: STYLE.fallbackImage || config.bot.thumbnail } };

    if (STYLE.headerMode === "none") return {};
    if (STYLE.headerMode === "image") return fallback;
    if (STYLE.headerMode === "video") {
        if (c.videoBuffer) return { video: c.videoBuffer, gifPlayback: STYLE.videoIsGif };
        return fallback;
    }
    return {};
};

const styledReply = (ctx, payload) => {
    const { fakeMsg, contextInfo } = buildStyle();
    const hasMedia = !!(payload.video || payload.image || payload.album);

    const content = hasMedia
        ? { ...payload, contextInfo }
        : (() => {
            const { caption, ...rest } = payload;
            return { ...rest, text: caption, contextInfo };
        })();

    return ctx.reply(content, { quoted: fakeMsg });
};

// ╭───────────────୨୧
// │ TOKEN HELPERS
// ╰───────────────୨୧

const fmtNum = (n) => Number(n || 0).toLocaleString("en-US");

const fmtShort = (n) => {
    const v = Number(n || 0);
    if (v < 1000) return String(v);
    if (v < 1_000_000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k";
    return (v / 1_000_000).toFixed(1) + "M";
};

const tokenBar = (pct, len = 10) => {
    const filled = Math.max(0, Math.min(len, Math.round((pct / 100) * len)));
    return "█".repeat(filled) + "░".repeat(len - filled);
};

const tokenTag = (pct) => (pct >= 90 ? "🔴" : pct >= 70 ? "🟡" : "🟢");

// Compute the token usage section as a string. Returns "" if the limiter
// is unavailable so the profile still renders.
const tokenSection = (ctx, userDb, isOwner) => {
    let used = 0, limit = 0;
    try {
        const tokenId = ctx.getId(ctx.sender.jid || ctx.sender.lid);
        used = tokenLimiter.getUsed(tokenId) || 0;
        limit = tokenLimiter.getLimit(tokenId, isOwner, Boolean(userDb?.premium)) || 0;
    } catch (e) {
        console.error("[profile] token limiter failed:", e.message);
        return "";
    }

    // Owner — unlimited
    if (isOwner || limit === 0) {
        return (
            "╭┈┈┈┈┈┈┈┈୨୧\n" +
            "┊ ✦ 𝑻𝒐𝒌𝒆𝒏 𝑼𝒔𝒂𝒈𝒆 ୨୧\n" +
            "┊ ♡ Limit › ∞ Unlimited ♡\n" +
            "┊ ♡ Used › " + fmtNum(used) + " tokens hari ni\n" +
            "╰┈┈┈┈┈┈┈┈୨୧\n\n"
        );
    }

    const pct = Math.min(100, Math.round((used / limit) * 100));
    const left = Math.max(0, limit - used);
    const tag = tokenTag(pct);
    const bar = tokenBar(pct);

    const warn = pct >= 90
        ? "\n┊ ⚠️ Dah nak dekat limit, jimat sikit ya~\n"
        : "";

    return (
        "╭┈┈┈┈┈┈┈┈୨୧\n" +
        "┊ ✦ 𝑻𝒐𝒌𝒆𝒏 𝑼𝒔𝒂𝒈𝒆 ୨୧\n" +
        `┊ ♡ Used › ${fmtNum(used)} / ${fmtNum(limit)}\n` +
        `┊ ♡ Left › ${fmtNum(left)} tokens\n` +
        `┊ ♡ Load › ${tag} \`${bar}\` ${pct}%\n` +
        "┊ ♡ Reset › 00:00 MYT\n" +
        warn +
        "╰┈┈┈┈┈┈┈┈୨୧\n\n"
    );
};

// ╭───────────────୨୧
// │ COMMAND
// ╰───────────────୨୧

module.exports = {
    name: "profile",
    aliases: ["me", "prof", "profil"],
    category: "profile",
    code: async (ctx) => {
        await warmStyle(ctx._client);

        const users = ctx.db.users.getAll();
        const userDb = ctx.db.user;
        const isOwner = ctx.sender.isOwner();

        const leaderboardData = users.map(user => ({
            id: user.id,
            level: user.level || 0,
            winGame: user.winGame || 0
        })).sort((a, b) => b.winGame - a.winGame || b.level - a.level);

        let status;
        if (isOwner) {
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

        const rank = leaderboardData.findIndex(user =>
            ctx.helper.areJidsSameUser(user.id, ctx.sender.lid)
        ) + 1;

        const num = ctx.getId(ctx.sender.lid);

        // ── token section (may be empty if limiter unavailable) ──
        const tokenBlock = tokenSection(ctx, userDb, isOwner);

        const text =
            "╭───────────────୨୧\n" +
            "│  ₊˚⊹♡  𝑼𝒔𝒆𝒓 𝑷𝒓𝒐𝒇𝒊𝒍𝒆  ♡⊹˚₊\n" +
            `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა  @${num}\n` +
            "│ (｡･ω･｡)ﾉ♡ Info akun kamu!\n" +
            "╰───────────────୨୧\n\n" +

            "╭┈┈┈┈┈┈┈┈୨୧\n" +
            "┊ ✦ 𝑷𝒓𝒐𝒇𝒊𝒍𝒆 ୨୧\n" +
            `┊ ♡ Nama      › ${ctx.sender.pushName || "Unknown"}\n` +
            `┊ ♡ Status    › ${status}\n` +
            `┊ ♡ Level     › ${userDb?.level || 0} (${userDb?.xp || 0}/100 XP)\n` +
            `┊ ♡ Coins     › ${isOwner || userDb?.premium ? "Unlimited ♡" : fmtNum(userDb?.coin || 0)}\n` +
            `┊ ♡ Menang    › ${userDb?.winGame || 0} game\n` +
            `┊ ♡ Peringkat › #${rank} dari ${fmtNum(users.length)} users\n` +
            "╰┈┈┈┈┈┈┈┈୨୧\n\n" +

            tokenBlock +

            "╭───────────────୨୧\n" +
            "│ (｡•̀ᴗ-)✧ Semangat terus mainnya ya! ♡\n" +
            "╰───────────────୨୧";

        await styledReply(ctx, {
            caption: text,
            mentions: [ctx.sender.lid],
            footer: config.msg.footer,
            optionText: "♡ Menu Selection",
            optionTitle: "୨୧ Pilih Opsi",
            nativeFlow: [
                { text: "♡ Klaim Hadiah", id: `${ctx.used.prefix}claim daily` },
                { text: "୨୧ Leaderboard", id: `${ctx.used.prefix}leaderboard` },
                { text: "♡ Check Token", id: `${ctx.used.prefix}token` },
                { text: "♡ Menu Utama", id: `${ctx.used.prefix}menu` }
            ]
        });
    }
};