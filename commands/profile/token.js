const tokenLimiter = require("../../lib/telegram/token-limiter");

// ╭───────────────୨୧
// │ STYLE
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

let _cache = null, _promise = null;
const warmStyle = (sock) => {
    if (_cache) return Promise.resolve(_cache);
    if (_promise) return _promise;
    _promise = (async () => {
        const fs = require("fs");
        const c = { videoBuffer: null, thumbBuffer: null, newsletterJid: null };
        if (STYLE.headerMode === "video") {
            try { const vp = STYLE.dir + STYLE.videoFile; if (fs.existsSync(vp)) c.videoBuffer = fs.readFileSync(vp); } catch (_) {}
        }
        try { const tp = STYLE.dir + STYLE.adThumbFile; if (fs.existsSync(tp)) c.thumbBuffer = fs.readFileSync(tp); } catch (_) {}
        if (STYLE.enableChannel) {
            try { const m = await sock.newsletterMetadata("invite", STYLE.channelInvite); c.newsletterJid = m?.id; } catch (_) {}
        }
        _cache = c; _promise = null; return c;
    })();
    return _promise;
};
const buildStyle = () => {
    const c = _cache || {};
    const stanzaId = "3EB0" + Math.random().toString(36).slice(2, 12).toUpperCase();
    const fakeMsg = {
        key: { id: stanzaId, remoteJid: "status@broadcast", fromMe: false, participant: "0@s.whatsapp.net" },
        message: { conversation: STYLE.quoteText },
        verifiedBizName: STYLE.quoteName, pushName: STYLE.quoteName
    };
    const contextInfo = {
        stanzaId, participant: "0@s.whatsapp.net", remoteJid: "status@broadcast",
        quotedMessage: { conversation: STYLE.quoteText },
        ...(STYLE.quoteVerified ? { verifiedBizName: STYLE.quoteName } : {})
    };
    if (STYLE.enableForward) { contextInfo.forwardingScore = STYLE.forwardScore; contextInfo.isForwarded = true; }
    if (STYLE.enableChannel && c.newsletterJid) {
        contextInfo.forwardedNewsletterMessageInfo = {
            newsletterJid: c.newsletterJid, newsletterName: STYLE.channelName, serverMessageId: STYLE.channelServerId
        };
    }
    if (STYLE.enableAdReply) {
        contextInfo.externalAdReply = {
            title: STYLE.adTitle, body: STYLE.adBody, mediaType: 1,
            sourceUrl: STYLE.adSourceUrl, mediaUrl: STYLE.adSourceUrl,
            renderLargerThumbnail: STYLE.adRenderLarge, showAdAttribution: STYLE.adShowAttribution,
            ...(c.thumbBuffer ? { thumbnail: c.thumbBuffer } : {})
        };
    }
    return { fakeMsg, contextInfo };
};
const styledReply = (ctx, payload) => {
    const { fakeMsg, contextInfo } = buildStyle();
    const hasMedia = !!(payload.video || payload.image || payload.album);
    const content = hasMedia
        ? { ...payload, contextInfo }
        : (() => { const { caption, ...rest } = payload; return { ...rest, text: caption, contextInfo }; })();
    return ctx.reply(content, { quoted: fakeMsg });
};

// ╭───────────────୨୧
// │ COMMAND
// ╰───────────────୨୧

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const bar = (p, len = 12) => {
    const f = Math.max(0, Math.min(len, Math.round((p / 100) * len)));
    return "█".repeat(f) + "░".repeat(len - f);
};
const tag = (p) => (p >= 90 ? "🔴" : p >= 70 ? "🟡" : "🟢");

const timeUntilReset = () => {
    const now = new Date();
    const kl = new Date(now.getTime() + (8 * 60 - now.getTimezoneOffset()) * 60000);
    const next = new Date(kl);
    next.setHours(24, 0, 0, 0);
    const diff = next - kl;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${h}h ${m}m`;
};

module.exports = {
    name: "token",
    aliases: ["mytoken", "cektokens", "usage", "checktoken", "cektoken"],
    category: "profile",
    code: async (ctx) => {
        await warmStyle(ctx._client);

        const isOwner = ctx.sender.isOwner();
        const userDb = ctx.db.user;
        const tokenId = ctx.getId(ctx.sender.jid || ctx.sender.lid);
        const num = ctx.getId(ctx.sender.lid);

        let used = 0, limit = 0;
        try {
            used = tokenLimiter.getUsed(tokenId) || 0;
            limit = tokenLimiter.getLimit(tokenId, isOwner, Boolean(userDb?.premium)) || 0;
        } catch (e) {
            console.error("[token]", e.message);
            return await ctx.reply(ctx.format.info("❌ Token limiter unavailable."));
        }

        // ── Owner ───────────────────────────────────────
        if (isOwner || limit === 0) {
            return await styledReply(ctx, {
                caption:
                    "╭───────────────୨୧\n" +
                    "│  ₊˚⊹♡  𝑻𝒐𝒌𝒆𝒏 𝑼𝒔𝒂𝒈𝒆  ♡⊹˚₊\n" +
                    "│  (｡･ω･｡)ﾉ♡ Unlimited access\n" +
                    "╰───────────────୨୧\n\n" +
                    `┊ ♡ User › @${num}\n` +
                    "┊ ♡ Limit › ∞ Unlimited\n" +
                    `┊ ♡ Used today › ${fmt(used)} tokens\n\n` +
                    "♡ Owner & premium — no daily cap.",
                mentions: [ctx.sender.lid],
                footer: config.msg.footer
            });
        }

        // ── Regular / Premium ───────────────────────────
        const pct = Math.min(100, Math.round((used / limit) * 100));
        const left = Math.max(0, limit - used);
        const t = tag(pct);
        const b = bar(pct);

        const warn = pct >= 90 ? "\n⚠️ Dah nak dekat limit. Jimat sikit ya~"
                   : pct >= 70 ? "\n💡 Dah guna lebih 70% limit harian."
                   : "";

        await styledReply(ctx, {
            caption:
                "╭───────────────୨୧\n" +
                "│  ₊˚⊹♡  𝑻𝒐𝒌𝒆𝒏 𝑼𝒔𝒂𝒈𝒆  ♡⊹˚₊\n" +
                "│  (｡･ω･｡)ﾉ♡ Status hari ni\n" +
                "╰───────────────୨୧\n\n" +

                "╭┈┈┈┈┈┈┈┈୨୧\n" +
                `┊ ♡ User › @${num}\n` +
                `┊ ♡ Tier › ${userDb?.premium ? "💎 Premium" : "🆓 Regular"}\n` +
                `┊ ♡ Limit › ${fmt(limit)} / hari\n` +
                `┊ ♡ Used › ${fmt(used)}\n` +
                `┊ ♡ Left › ${fmt(left)}\n` +
                `┊ ♡ Load › ${t} \`${b}\` ${pct}%\n` +
                "╰┈┈┈┈┈┈┈┈୨୧\n\n" +
                `♡ Reset dalam › ${timeUntilReset()}\n` +
                `♡ Reset pada › 00:00 MYT` +
                warn,
            mentions: [ctx.sender.lid],
            footer: config.msg.footer,
            optionText: "♡ Menu Selection",
            optionTitle: "୨୧ Pilih Opsi",
            nativeFlow: [
                { text: "♡ Profile", id: `${ctx.used.prefix}profile` },
                { text: "୨୧ Upgrade", id: `${ctx.used.prefix}price` },
                { text: "♡ Menu Utama", id: `${ctx.used.prefix}menu` }
            ]
        });
    }
};