// help.js — one source of truth for command discovery (UI/UX layer).
//
// WHY THIS EXISTS
// The bot ships 157 commands across 118 files. 43 of them have no alias at all,
// and every "how to use me" template lives inside the command itself — so it is
// only reachable AFTER you already know the command name. New users arrive with
// muscle memory from other bots (.close, .setwelcome, .antilink) and get
// silence: `didyoumean` has no candidates close to those words, so the message
// simply vanishes. That is the single biggest UX defect in this bot.
//
// WHAT THIS MODULE PROVIDES
//   COMMANDS  plain-language "what it does" + usage + permission badges, per command
//   SUBS      sub-command help for dispatchers (.group close, .setoption antilink...)
//   COMMON    other-bot command names -> this bot's command (the discovery map)
//   functions card / categoryCard / subCard / quickStart / suggestCard / resolveToken
//
// Everything renders through ctx.format so the visual language matches the rest
// of the bot. Add a command here and it automatically shows up in `.menu` and
// becomes reachable through `.help <name>`.

const CATEGORY_LABELS = {
    main: "Menu & Bantuan",
    group: "Urusan Grup",
    profile: "Profil & Koin",
    downloader: "Download",
    search: "Cari",
    converter: "Tukar Format",
    tool: "Alat",
    ai: "AI",
    maker: "Buat Gambar/Sticker",
    misc: "Lain-lain",
    information: "Info Bot",
    owner: "Owner",
    game: "Game"
};

// Categories in the order they should be offered to users. Group first because
// that is what admins actually come for.
const CATEGORY_ORDER = [
    "group", "profile", "downloader", "ai", "tool", "converter",
    "maker", "search", "game", "misc", "information", "owner", "main"
];

// name: [category, what it does, example args (null = no args needed)]
const COMMANDS = {
    // ---- main ----
    menu: ["main", "Tunjuk menu utama + senarai semua perintah", null],
    help: ["main", "Panduan mula + detail mana-mana perintah", "close"],

    // ---- group ----
    group: ["group", "Kunci / buka grup, urus permintaan masuk", "close"],
    setoption: ["group", "Hidup/mati auto-mod grup (antilink, antispam, welcome...)", "antilink"],
    settext: ["group", "Set mesej welcome / goodbye / intro grup", "welcome Halo %tag%!"],
    warning: ["group", "Bagi warning pada member (auto kick bila cukup)", "@user"],
    unwarning: ["group", "Tarik balik warning member", "@user"],
    listwarning: ["group", "Senarai member yang ada warning", null],
    mute: ["group", "Sekat member dari chat (boleh set berapa hari)", "@user 3"],
    unmute: ["group", "Buka sekat member", "@user"],
    listmute: ["group", "Senarai member yang kena sekat", null],
    kick: ["group", "Keluarkan member dari grup", "@user"],
    add: ["group", "Tambah nombor ke dalam grup", "60123456789"],
    promote: ["group", "Naikkan member jadi admin", "@user"],
    demote: ["group", "Turunkan admin jadi member biasa", "@user"],
    approve: ["group", "Terima permintaan masuk grup", "all"],
    reject: ["group", "Tolak permintaan masuk grup", "all"],
    listpendingmembers: ["group", "Senarai permintaan masuk yang menunggu", null],
    setname: ["group", "Tukar nama grup", "Nama Baru"],
    setdescription: ["group", "Tukar deskripsi grup", "Deskripsi baru"],
    setpp: ["group", "Tukar gambar profil grup (hantar/balas gambar)", null],
    link: ["group", "Ambil link undangan grup", null],
    intro: ["group", "Tunjuk teks intro grup", null],
    tagall: ["group", "Tag semua member dengan mesej", "Kumpul sini!"],
    hidetag: ["group", "Tag semua member tanpa nampak senarai nama", "Kumpul sini!"],
    tagme: ["group", "Tag diri sendiri", null],
    groupstatus: ["group", "Hantar status ke grup", "Halo semua!"],
    setmaxwarnings: ["group", "Set berapa warning sebelum auto-kick", "3"],
    simulate: ["group", "Uji mesej welcome/goodbye tanpa tunggu member betul", "join"],
    topyapping: ["group", "Ranking member paling banyak chat", null],
    topsider: ["group", "Ranking member paling sikit chat", null],
    kickidle: ["group", "Keluarkan ahli paling sepi (2 langkah, ada pratonton)", "20"],
    resetai: ["group", "Reset memori AI (Alya) untuk chat ni", null],

    // ---- profile ----
    profile: ["profile", "Tunjuk profil, level, koin, status premium", null],
    level: ["profile", "Tunjuk level + XP", null],
    xp: ["profile", "Tunjuk XP terkumpul", null],
    coin: ["profile", "Tunjuk baki koin", null],
    claim: ["profile", "Klaim hadiah harian / mingguan / bulanan", "daily"],
    afk: ["profile", "Set status AFK + auto balas bila di-tag", "makan"],
    leaderboard: ["profile", "Ranking koin / level", null],
    transfer: ["profile", "Hantar koin ke user lain", "@user 100"],
    autodownload: ["profile", "Auto download link yang dihantar", "on"],
    reset: ["profile", "Reset data profil sendiri", null],

    // ---- downloader ----
    play: ["downloader", "Cari & download lagu (mp3)", "judul lagu"],
    playvid: ["downloader", "Cari & download video (mp4)", "judul video"],
    youtubevideo: ["downloader", "Download video YouTube dari link", "https://youtu.be/..."],
    youtubeaudio: ["downloader", "Download audio YouTube dari link", "https://youtu.be/..."],
    tiktokdl: ["downloader", "Download TikTok", "https://vt.tiktok.com/..."],
    instagramdl: ["downloader", "Download Instagram", "https://instagram.com/p/..."],
    facebookdl: ["downloader", "Download Facebook", "https://fb.watch/..."],
    spotifydl: ["downloader", "Download Spotify", "https://open.spotify.com/..."],
    pinterestdl: ["downloader", "Download Pinterest", "https://pin.it/..."],
    anime: ["downloader", "Cari & tonton anime", "naruto"],
    telegramstickerdl: ["downloader", "Ambil sticker dari Telegram", "https://t.me/addstickers/..."],

    // ---- search ----
    youtubesearch: ["search", "Cari video YouTube", "kata kunci"],
    spotifysearch: ["search", "Cari lagu Spotify", "kata kunci"],
    tiktoksearch: ["search", "Cari video TikTok", "kata kunci"],

    // ---- converter ----
    sticker: ["converter", "Jadikan gambar / video jadi sticker", null],
    stickerwm: ["converter", "Jadikan sticker dengan watermark", null],
    toimage: ["converter", "Sticker jadi gambar", null],
    tovideo: ["converter", "Sticker / GIF jadi video", null],
    toaudio: ["converter", "Video jadi audio (mp3)", null],
    togif: ["converter", "Video jadi GIF", null],

    // ---- tool ----
    fetch: ["tool", "Ambil kandungan sesuatu link", "https://example.com"],
    hd: ["tool", "Naikkan kualiti gambar (HD)", null],
    hdvideo: ["tool", "Naikkan kualiti video (HD)", null],
    ocr: ["tool", "Baca teks dari gambar", null],
    translate: ["tool", "Terjemah teks", "en Halo dunia"],
    screenshot: ["tool", "Screenshot website", "https://example.com"],
    createqrcode: ["tool", "Buat QR code dari teks/link", "https://example.com"],
    scanqrcode: ["tool", "Baca QR code dari gambar", null],
    removebackground: ["tool", "Buang background gambar", null],
    upload: ["tool", "Upload file dan dapat link", null],
    pinterest: ["tool", "Cari gambar Pinterest", "kata kunci"],
    bypassshortlink: ["tool", "Buka link pendek (shortlink)", "https://shorturl.at/..."],
    lyric: ["tool", "Cari lirik lagu", "judul lagu"],
    alquran: ["tool", "Baca Al-Quran", "1:1"],
    alkitab: ["tool", "Baca Alkitab", "Yohanes 3:16"],
    am: ["tool", "Buat gambar ALIGHT MOTION", "teks"],

    // ---- ai ----
    kryzz: ["ai", "Tanya AI Kryzz — agent yang boleh buat kerja server", "cek sisa disk"],
    chatgpt: ["ai", "Tanya AI ChatGPT", "soalan"],
    flux: ["ai", "Buat gambar dengan AI (Flux)", "kucing pakai topi"],
    nanobanana: ["ai", "Buat / edit gambar dengan AI (Nano Banana)", "soalan"],

    // ---- maker ----
    brat: ["maker", "Buat sticker brat", "teks"],
    bratgif: ["maker", "Buat sticker brat versi GIF", "teks"],
    quotlychat: ["maker", "Buat gambar quote chat", "teks"],
    iphonequotedchat: ["maker", "Buat quote gaya iPhone", "teks"],
    stickermeme: ["maker", "Buat sticker meme", "teks"],

    // ---- misc ----
    getpp: ["misc", "Ambil gambar profil seseorang", "@user"],
    getstatus: ["misc", "Ambil status WhatsApp seseorang", "@user"],
    readviewonce: ["misc", "Baca mesej sekali lihat (view once)", null],
    collector: ["misc", "Buat collector mesej", null],
    getinput: ["misc", "Minta input dari user", null],

    // ---- information ----
    about: ["information", "Info pasal bot", null],
    owner: ["information", "Hubungi owner", null],
    ping: ["information", "Cek bot hidup ke tak", null],
    uptime: ["information", "Berapa lama bot hidup", null],
    sc: ["information", "Tunjuk source code", null],
    speedtest: ["information", "Uji kelajuan server", null],
    donate: ["information", "Info donasi", null],
    price: ["information", "Harga premium / sewa bot", null],
    listapis: ["information", "Senarai API yang bot guna", null],
    botgroup: ["information", "Link grup bot", null],
    server: ["information", "Info server", null],

    // ---- owner ----
    mode: ["owner", "Set mode bot (public/group/private/premium/self)", "public"],
    restart: ["owner", "Restart bot", null],
    broadcastgc: ["owner", "Broadcast mesej ke semua grup", "mesej"],
    broadcastgcsw: ["owner", "Broadcast ke status grup", "mesej"],
    join: ["owner", "Masuk grup dari link", "https://chat.whatsapp.com/..."],
    label: ["owner", "Label sesuatu", null],
    listgroup: ["owner", "Senarai grup yang bot join", null],
    banuser: ["owner", "Ban user dari guna bot", "@user"],
    unbanuser: ["owner", "Buka ban user", "@user"],
    listbanuser: ["owner", "Senarai user yang kena ban", null],
    addpremiumuser: ["owner", "Naikkan user jadi premium", "@user 30"],
    delpremiumuser: ["owner", "Tarik premium user", "@user"],
    listpremiumuser: ["owner", "Senarai user premium", null],
    addcoinuser: ["owner", "Tambah koin user", "@user 100"],
    addsewagroup: ["owner", "Aktifkan sewa untuk grup", "@group 30"],
    delsewagroup: ["owner", "Tarik sewa grup", null],
    listsewagroup: ["owner", "Senarai grup yang menyewa", null],
    osettext: ["owner", "Set teks owner (donate / price / qris)", "donate teks..."],
    setbotname: ["owner", "Tukar nama bot", "Nama Baru"],
    setbotpp: ["owner", "Tukar gambar profil bot", null],
    setbotcover: ["owner", "Tukar cover bot", null],
    setlimittoken: ["owner", "Set had token harian user", "@user 100000"],
    checkapis: ["owner", "Cek status semua API", null],
    ptero: ["owner", "Urus panel Pterodactyl", "servers"],
    autoai: ["owner", "Hidup/mati auto-reply AI dalam chat ni", "on"],
    testrich: ["owner", "Test rich response", null],

    // ---- game ----
    cerdascermat: ["game", "Game cerdas cermat (bonus koin)", null],
    coinflip: ["game", "Lempar koin — pilih kepala/ekor", "kepala"],
    dice: ["game", "Lempar dadu", null],
    family100: ["game", "Game family 100", null],
    gamble: ["game", "Pertaruh koin", "100"],
    hangman: ["game", "Game hangman", null],
    maths: ["game", "Soalan matematik (bonus koin)", null]
};

// Quiz games share one file (commands/game/quiz.js) — one entry each so they
// appear in the menu and in `.help`.
for (const q of [
    "asahotak", "caklontong", "lengkapikalimat", "siapakahaku", "susunkata",
    "tebakbendera", "tebakgambar", "tebakgame", "tebakheroml", "tebakhewan",
    "tebakjkt48", "tebakkalimat", "tebakkarakterff", "tebakkartun", "tebakkata",
    "tebakkimia", "tebaklagu", "tebaklirik", "tebaklogo", "tebaktebakan", "tebakwarna",
    "tekateki"
]) COMMANDS[q] = ["game", "Game tebak-tebakan (bonus koin)", null];

// ---------------------------------------------------------------------------
// Sub-command help for dispatchers. These are the commands users fight with,
// because the real action is hidden behind a sub-word.
// ---------------------------------------------------------------------------
const SUBS = {
    group: {
        label: "Kunci / Buka Grup",
        intro: "Kawal siapa yang boleh hantar mesej dan siapa yang boleh masuk.",
        items: {
            close: "Tutup grup — hanya admin boleh hantar mesej",
            open: "Buka grup — semua member boleh hantar mesej",
            lock: "Kunci tetapan grup (admin sahaja boleh ubah)",
            unlock: "Buka kunci tetapan grup",
            approve: "Hidupkan persetujuan admin untuk member baru masuk",
            disapprove: "Matikan persetujuan masuk",
            invite: "Benarkan member biasa tambah orang lain",
            restrict: "Hanya admin boleh tambah orang"
        }
    },
    setoption: {
        label: "Auto-Mod Grup",
        intro: "Hidup/mati satu-satu pengawal automatik. Hantar nama sahaja untuk togol.",
        items: {
            antilink: "Padam + warning mesej yang ada link",
            antispam: "Padam + warning member yang spam",
            antitoxic: "Padam + warning kata kasar / toxic",
            antiaudio: "Halang member hantar audio",
            antidocument: "Halang member hantar dokumen",
            antiimage: "Halang member hantar gambar",
            antisticker: "Halang member hantar sticker",
            antivideo: "Halang member hantar video",
            antigcsw: "Halang hantar status grup",
            antitagsw: "Halang tag status WhatsApp",
            autokick: "Terus kick pelanggar (tanpa warning)",
            gamerestrict: "Hadkan perintah game untuk member biasa",
            welcome: "Hidupkan mesej sambutan member baru"
        }
    },
    settext: {
        label: "Mesej Grup",
        intro: "Set mesej automatik. Boleh guna %tag%, %subject%, %description%.",
        items: {
            welcome: "Mesej bila member baru masuk",
            goodbye: "Mesej bila member keluar",
            intro: "Mesej yang keluar bila orang ketik .intro"
        }
    },
    mode: {
        label: "Mode Bot",
        intro: "Siapa yang bot layan.",
        items: {
            public: "Semua orang, grup dan private",
            group: "Dalam grup sahaja",
            private: "Dalam private sahaja",
            premium: "Hanya premium dan owner",
            self: "Hanya owner"
        }
    },
    claim: {
        label: "Klaim Hadiah",
        intro: "Hadiah koin berkala. Setiap satu ada masa tunggu sendiri.",
        items: {
            daily: "Hadiah harian (reset 24 jam)",
            weekly: "Hadiah mingguan (reset 7 hari)",
            monthly: "Hadiah bulanan (reset 30 hari)",
            yearly: "Hadiah tahunan (reset 365 hari)"
        }
    },
    osettext: {
        label: "Teks Owner",
        intro: "Set teks yang bot tunjuk untuk donasi / harga.",
        items: {
            donate: "Teks donasi (%tag%, %name%, %prefix%)",
            price: "Teks harga premium & sewa",
            qris: "Link gambar QRIS untuk pembayaran"
        }
    }
};

// ---------------------------------------------------------------------------
// COMMON — the discovery map. Names users bring from other bots, mapped to the
// command (and sub-command) that actually does the job here. This is what turns
// a silent dead-end into "oh, it's .group close".
// ---------------------------------------------------------------------------
const COMMON = {
    // group lock/open
    close: ["group", "close"], open: ["group", "open"],
    lock: ["group", "lock"], unlock: ["group", "unlock"],
    tutup: ["group", "close"], buka: ["group", "open"],
    groupclose: ["group", "close"], groupopen: ["group", "open"],
    closegroup: ["group", "close"], opengroup: ["group", "open"],
    // welcome / goodbye text
    setwelcome: ["settext", "welcome"], setgoodbye: ["settext", "goodbye"],
    setintro: ["settext", "intro"],
    // bare `.welcome` toggles the welcome messages (setoption), it does NOT set
    // the text — that is `.setwelcome <text>`. Matches other bots' behaviour.
    welcome: ["setoption", "welcome"],
    // auto-mod toggles
    antilink: ["setoption", "antilink"], antispam: ["setoption", "antispam"],
    antitoxic: ["setoption", "antitoxic"], antiaudio: ["setoption", "antiaudio"],
    antidocument: ["setoption", "antidocument"], antiimage: ["setoption", "antiimage"],
    antisticker: ["setoption", "antisticker"], antivideo: ["setoption", "antivideo"],
    antigcsw: ["setoption", "antigcsw"], antitagsw: ["setoption", "antitagsw"],
    autokick: ["setoption", "autokick"], gamerestrict: ["setoption", "gamerestrict"],
    // misc muscle memory (only honest 1:1 mappings — no `.kickall` here, because
    // `.kick` needs a target and pretending they are the same would mislead)
    setmode: ["mode", null], botmode: ["mode", null],
    setgroupname: ["setname", null], setgcname: ["setname", null],
    setdesc: ["setdescription", null], setgcdesc: ["setdescription", null],
    setmaxwarn: ["setmaxwarnings", null], maxwarn: ["setmaxwarnings", null],
    gclink: ["link", null], grouplink: ["link", null],
    warn: ["warning", null], unwarn: ["unwarning", null],
    kickidle: ["kickidle", null], kicksepi: ["kickidle", null],
    kickdead: ["kickidle", null], buangsepi: ["kickidle", null],
    sider: ["topsider", null], yapping: ["topyapping", null],
    commands: ["menu", null], panduan: ["menu", null], start: ["menu", null],
    cmd: ["menu", null], bantuan: ["menu", null], help: ["menu", null],
    allmenu: ["menu", null],
    down: ["play", null], song: ["play", null], mp3: ["play", null],
    video: ["playvid", null], mp4: ["playvid", null],
    sticker: ["sticker", null], stiker: ["sticker", null],
    level: ["level", null], rank: ["level", null], balance: ["coin", null],
    koin: ["coin", null], daily: ["claim", null], bonus: ["claim", null],
    tag: ["tagall", null], everyone: ["tagall", null], all: ["tagall", null]
};

// Words that look like command tokens but are almost always just chatter.
// The typo catcher stays silent for these so the bot never talks over a
// normal conversation.
const CHATTER = new Set([
    "halo", "hai", "hi", "hey", "hei", "helo", "hello", "yo", "woi", "oi",
    "ok", "oke", "okay", "okey", "ya", "ye", "yes", "tak", "no", "nah",
    "test", "testing", "tes", "done", "siap", "lol", "wkwk", "wkwkwk",
    "haha", "hahaha", "xd", "hmm", "hm", "eh", "ah", "oh", "lah", "lahh",
    "thanks", "tq", "thx", "ty", "bye", "salam", "assalamualaikum", "pagi",
    "malam", "siang", "petang", "kenapa", "apa", "mana", "siapa", "bila"
]);

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

// A message "looks like a command" when it opens with a prefix char followed by
// a command-shaped word. Matches the same prefix family the client accepts.
// The word is CAPTURED — an earlier version consumed it during the prefix strip
// and left nothing to look up.
const PREFIX_RE = /^[°•π÷×¶∆£¢€¥®™+✓_=|/~!?@#%^&.©^-]\s*([a-zA-Z][a-zA-Z0-9_]*)/;

function entry(name) {
    const key = String(name || "").toLowerCase().replace(/^[/!.#]/, "").trim();
    if (!COMMANDS[key]) return null;
    const [category, what, example] = COMMANDS[key];
    return { name: key, category, what, example };
}

// Resolve a bare token the user typed into { command, sub, via } or null.
// Order: real command name -> other-bot name -> fuzzy match.
function resolveToken(token) {
    const key = String(token || "").toLowerCase().replace(/^[/!.#]/, "").trim();
    if (!key) return null;
    if (COMMANDS[key]) return { command: key, sub: null, via: "command" };
    if (COMMON[key]) {
        const [command, sub] = COMMON[key];
        return { command, sub, via: "common" };
    }
    const fuzzy = suggest(key);
    if (fuzzy && fuzzy.length) return { command: fuzzy[0], sub: null, via: "fuzzy" };
    return null;
}

// Cheap edit-distance fuzzy match over command names + aliases + COMMON keys.
function suggest(token, limit = 1) {
    const candidates = [...Object.keys(COMMANDS), ...Object.keys(COMMON)];
    const scored = [];
    for (const c of candidates) {
        const d = distance(token, c);
        // accept only genuinely close matches, scaled by word length
        const tolerance = token.length <= 4 ? 1 : 2;
        if (d <= tolerance) scored.push({ c, d });
    }
    scored.sort((a, b) => a.d - b.d || a.c.length - b.c.length);
    return scored.length ? scored.slice(0, limit).map(s => s.c) : null;
}

function distance(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
            cur[j] = Math.min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        prev = cur;
    }
    return prev[n];
}

// Would this token plausibly be a command attempt? Letters only, 2+ chars, and
// not a common chatter word. Used by the typo catcher so normal conversation
// never triggers a "command not found" reply.
function looksLikeCommand(token) {
    const t = String(token || "").trim();
    if (!/^[a-z]{2,20}$/i.test(t)) return false;
    return !CHATTER.has(t.toLowerCase());
}

// Decide whether an unmatched command token deserves a reply. Returns
// { token, hit } when the bot should answer, or null to stay silent.
// `hit` is the resolved command (may be null = nothing close found).
//
// MUST be fed a message that actually carries a command prefix. The whole point
// is to help someone who typed `.close`; without this guard, the words "close",
// "open", "welcome" and "all" — which are now real aliases — would fire a
// suggestion card on ordinary group conversation. Chatter words (halo, wkwk,
// ok...) are rejected too.
function detectUnknown(body) {
    const raw = String(body || "").trim();
    if (!raw) return null;
    // First line only: a prefixed command never spans lines, and this keeps the
    // scan cheap on long messages.
    const first = raw.split("\n")[0].trim();
    const m = first.match(PREFIX_RE);
    if (!m) return null;                              // must look like a command
    const t = m[1].toLowerCase();
    if (!looksLikeCommand(t)) return null;
    if (COMMANDS[t]) return null;
    return { token: t, hit: resolveToken(t) };
}

// Anti-spam for the unknown-command reply: at most one per chat per window, so
// a group where five people mistype the same command doesn't get five cards.
const UNKNOWN_WINDOW_MS = 30000;
const lastUnknownAt = new Map();
function throttleUnknown(chatId) {
    const now = Date.now();
    const last = lastUnknownAt.get(String(chatId)) || 0;
    if (now - last < UNKNOWN_WINDOW_MS) return false;
    lastUnknownAt.set(String(chatId), now);
    // keep the map from growing forever
    if (lastUnknownAt.size > 500) {
        for (const [k, v] of lastUnknownAt) if (now - v > UNKNOWN_WINDOW_MS * 4) lastUnknownAt.delete(k);
    }
    return true;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function permBadges(perms = {}) {
    let out = "";
    if (perms.coin) out += " ⓒ";
    if (perms.group) out += " Ⓖ";
    if (perms.owner) out += " Ⓞ";
    if (perms.premium) out += " Ⓟ";
    if (perms.private) out += " ⓟ";
    if (perms.admin) out += " 🛡️";
    return out;
}

function header(title, subtitle) {
    return "╭───────────────୨୧\n" +
        `│  ₊˚⊹♡  ${title}  ♡⊹˚₊\n` +
        (subtitle ? `│ ${subtitle}\n` : "") +
        "╰───────────────୨୧\n\n";
}

// Full detail card for one command.
function card(ctx, name) {
    const e = entry(name);
    if (!e) return null;
    const p = ctx.used?.prefix || ".";
    const live = [...ctx.bot.cmd.values()].find(c =>
        c.name === e.name || (Array.isArray(c.aliases) && c.aliases.includes(e.name)));
    const aliases = live?.aliases?.length ? live.aliases : [];
    const badges = permBadges(live?.permissions || {});
    const subs = SUBS[e.name];

    let text = header(`𝑷𝒆𝒓𝒊𝒏𝒕𝒂𝒉 › ${e.name}`, ctx.format.italic(e.what));
    text += "╭┈┈┈┈┈┈┈┈୨୧\n";
    text += `┊ ✦ 𝑪𝒂𝒓𝒂 𝑮𝒖𝒏𝒂\n`;
    text += `┊ ❖ ${ctx.format.inlineCode(`${p}${e.name}${e.example ? " " + e.example : ""}`)}\n`;
    if (aliases.length) text += `┊ ❖ Nama lain: ${ctx.format.inlineCode(aliases.map(a => p + a).join(", "))}\n`;
    if (badges) text += `┊ ❖ Syarat:${badges}\n`;
    text += "╰┈┈┈┈┈┈┈┈୨୧\n";

    if (subs) {
        text += "\n" + subList(ctx, e.name);
    }
    text += "\n" + permLegend();
    return text;
}

// Sub-command list for a dispatcher command.
function subList(ctx, name) {
    const s = SUBS[name];
    if (!s) return "";
    const p = ctx.used?.prefix || ".";
    let text = "╭┈┈┈┈┈┈┈┈୨୧\n" +
        `┊ ✦ ${ctx.format.bold(s.label)} ୨୧\n` +
        `┊ ${ctx.format.italic(s.intro)}\n` +
        "┊\n";
    for (const [sub, what] of Object.entries(s.items)) {
        text += `┊ ❖ ${ctx.format.inlineCode(`${p}${name} ${sub}`)}\n┊    ♡ ${what}\n`;
    }
    text += "╰┈┈┈┈┈┈┈┈୨୧";
    return text;
}

// What a dispatcher does when called with no arguments. When `sub` is given,
// render a focused card for just that sub-command — that is what `.help close`
// shows, so a user who only knows the other bot's name still gets the full
// answer (usage + what it does + how to actually run it).
function subCard(ctx, name, sub = null) {
    const s = SUBS[name];
    if (!s) return null;
    const p = ctx.used?.prefix || ".";
    const key = String(sub || "").toLowerCase();
    const what = s.items[key];

    if (what) {
        const usage = `${p}${name} ${key}`;
        let text = header(`𝑷𝒆𝒓𝒊𝒏𝒕𝒂𝒉 › ${key}`, ctx.format.italic(what));
        text += "╭┈┈┈┈┈┈┈┈୨୧\n" +
            "┊ ✦ 𝑪𝒂𝒓𝒂 𝑮𝒖𝒏𝒂\n" +
            `┊ ❖ ${ctx.format.inlineCode(usage)}\n` +
            `┊ ❖ Dalam: ${ctx.format.inlineCode(p + name)} (${s.label})\n` +
            "╰┈┈┈┈┈┈┈┈୨୧\n\n";
        const others = Object.keys(s.items).filter(k => k !== key).slice(0, 4);
        text += "╭┈┈┈┈┈┈┈┈୨୧\n" +
            "┊ ✦ 𝑶𝒑𝒔𝒊 𝑳𝒂𝒊𝒏 ୨୧\n" +
            others.map(k => `┊ ❖ ${ctx.format.inlineCode(`${p}${name} ${k}`)}\n┊    ♡ ${s.items[k]}`).join("\n") + "\n" +
            "╰┈┈┈┈┈┈┈┈୨୧\n\n" +
            `(｡･ω･｡) Nak semua pilihan? Ketik ${ctx.format.inlineCode(p + "help " + name)}`;
        return text;
    }

    let text = header(`𝑷𝒆𝒓𝒊𝒏𝒕𝒂𝒉 › ${name}`, ctx.format.italic(s.intro));
    text += subList(ctx, name) + "\n\n";
    text += "╭───────────────୨୧\n" +
        `│ ♡ Contoh: ${ctx.format.inlineCode(`${p}${name} ${Object.keys(s.items)[0]}`)}\n` +
        "╰───────────────୨୧";
    return text;
}

function permLegend() {
    return "╭───────────────୨୧\n" +
        "│ ♡ 𝑺𝒚𝒂𝒓𝒂𝒕 ୨୧\n" +
        "│ Ⓖ dalam grup   ⓟ private\n" +
        "│ Ⓞ owner         Ⓟ premium\n" +
        "│ ⓒ guna koin     🛡️ admin grup\n" +
        "╰───────────────୨୧";
}

// One category, with a plain-language line per command.
function categoryCard(ctx, category) {
    const key = String(category || "").toLowerCase();
    if (!CATEGORY_LABELS[key]) return null;
    const p = ctx.used?.prefix || ".";
    const names = Object.entries(COMMANDS)
        .filter(([, v]) => v[0] === key)
        .map(([n]) => n)
        .sort();

    // Two lines per command: name on one line, description indented below.
    // This is what was readable — Jack's complaint was the heavy border box
    // (╭┈┈┈┈┈┈┈┈୨୧) around every section, not the line count. The one-line
    // version crammed name+description together and WhatsApp wrapped it into
    // an unreadable mess. Keep two lines, drop the box.
    let text = header(`𝑴𝒆𝒏𝒖 › ${CATEGORY_LABELS[key]}`,
        `${names.length} perintah — ketik ${ctx.format.inlineCode(p + "help <nama>")} untuk detail\n`);
    for (const n of names) {
        text += `❖ ${ctx.format.inlineCode(p + n)}\n  ${COMMANDS[n][1]}\n`;
    }
    text += `\n${permLegend()}`;
    return text;
}

// The "I am new here" card. This is what .menu and .help should feel like.
function quickStart(ctx) {
    const p = ctx.used?.prefix || ".";
    const c = (s) => ctx.format.inlineCode(p + s);
    let text = header("𝑷𝒂𝒏𝒅𝒖𝒂𝒏 𝑴𝒖𝒍𝒂", "(｡･ω･｡)ﾉ♡ Baru guna bot? Baca ni dulu");

    text += "╭┈┈┈┈┈┈┈┈୨୧\n" +
        "┊ ✦ 𝑲𝒆𝒏𝒂𝒑𝒂 𝒃𝒐𝒕 𝒕𝒂𝒌 𝒃𝒂𝒍𝒂𝒔? ୨୧\n" +
        `┊ ♡ Semua perintah mesti ada ${ctx.format.inlineCode(p)} di depan.\n` +
        `┊ ♡ Contoh: ${c("close")} — bukan ${ctx.format.inlineCode("close")} sahaja.\n` +
        `┊ ♡ Perintah admin hanya jalan kalau bot jadi admin grup.\n` +
        "╰┈┈┈┈┈┈┈┈୨୧\n\n";

    text += "╭┈┈┈┈┈┈┈┈୨୧\n" +
        "┊ ✦ 𝑨𝒅𝒎𝒊𝒏 𝑮𝒓𝒖𝒑 — 𝒑𝒂𝒍𝒊𝒏𝒈 𝒔𝒆𝒓𝒊𝒏𝒈 𝒈𝒖𝒏𝒂 ୨୧\n" +
        "┊\n" +
        `┊ ❖ Tutup / buka grup\n┊    ♡ ${c("close")} · ${c("open")}\n` +
        `┊ ❖ Halang link & spam\n┊    ♡ ${c("antilink")} · ${c("antispam")}\n` +
        `┊ ❖ Sambutan member baru\n┊    ♡ ${c("welcome")} · ${c("setwelcome Halo %tag%!")}\n` +
        `┊ ❖ Bagi warning / kick\n┊    ♡ ${c("warn @user")} · ${c("kick @user")}\n` +
        `┊ ❖ Tag semua orang\n┊    ♡ ${c("tagall Kumpul sini!")}\n` +
        `┊ ❖ Senarai semua tetapan grup\n┊    ♡ ${c("setoption status")}\n` +
        "╰┈┈┈┈┈┈┈┈୨୧\n\n";

    text += "╭┈┈┈┈┈┈┈┈୨୧\n" +
        "┊ ✦ 𝑩𝒊𝒂𝒔𝒂 𝑶𝒓𝒂𝒏𝒈 𝑮𝒖𝒏𝒂 ୨୧\n" +
        "┊\n" +
        `┊ ❖ Download lagu / video\n┊    ♡ ${c("play judul lagu")} · ${c("playvid judul video")}\n` +
        `┊ ❖ Buat sticker\n┊    ♡ ${c("sticker")} (balas gambar)\n` +
        `┊ ❖ Tanya AI\n┊    ♡ ${c("kryzz cek sisa disk")} · ${c("chatgpt soalan")}\n` +
        `┊ ❖ Klaim koin\n┊    ♡ ${c("claim daily")} · ${c("coin")}\n` +
        `┊ ❖ Tonton anime\n┊    ♡ ${c("anime naruto")}\n` +
        "╰┈┈┈┈┈┈┈┈୨୧\n\n";

    text += "╭───────────────୨୧\n" +
        `│ ♡ Nak senarai penuh? ${c("menu all")}\n` +
        `│ ♡ Nak detail satu perintah? ${c("help close")}\n` +
        "╰───────────────୨୧";
    return text;
}

// Shown when a user types a command that does not exist but looks like one.
function suggestCard(ctx, token, hit) {
    const p = ctx.used?.prefix || ".";
    const clean = String(token || "").replace(/^[/!.#]/, "");

    if (hit) {
        const cmd = hit.command;
        const sub = hit.sub;
        const usage = `${p}${cmd}${sub ? " " + sub : ""}`;
        const what = sub
            ? (SUBS[cmd]?.items?.[sub] || COMMANDS[cmd]?.[1])
            : (COMMANDS[cmd]?.[1] || "");
        const why = hit.via === "common"
            ? `Di bot ni perintah tu dinamakan ${ctx.format.inlineCode(usage)}.`
            : `Mungkin maksud kamu ${ctx.format.inlineCode(usage)}?`;
        return {
            text: header("𝑷𝒆𝒓𝒊𝒏𝒕𝒂𝒉 𝑻𝒂𝒌 𝑫𝒊𝒕𝒆𝒎𝒖𝒊", `(｡•́︿•̀｡) ${ctx.format.inlineCode(p + clean)} tak ada dalam bot ni`)
                + "╭┈┈┈┈┈┈┈┈୨୧\n"
                + `┊ ✦ ${why}\n`
                + (what ? `┊ ♡ ${what}\n` : "")
                + "╰┈┈┈┈┈┈┈┈୨୧\n\n"
                + `(｡･ω･｡) Nak senarai penuh? Ketik ${ctx.format.inlineCode(p + "menu")}`,
            buttons: [
                { text: "♡ Guna Perintah Ni", id: usage },
                { text: "୨୧ Buka Menu", id: `${p}menu` }
            ]
        };
    }

    return {
        text: header("𝑷𝒆𝒓𝒊𝒏𝒕𝒂𝒉 𝑻𝒂𝒌 𝑫𝒊𝒕𝒆𝒎𝒖𝒊", `(｡•́︿•̀｡) ${ctx.format.inlineCode(p + clean)} tak ada dalam bot ni`)
            + "╭┈┈┈┈┈┈┈┈୨୧\n"
            + "┊ ✦ 𝑻𝒊𝒑𝒔 ୨୧\n"
            + `┊ ♡ Ketik ${ctx.format.inlineCode(p + "menu")} untuk senarai penuh.\n`
            + `┊ ♡ Ketik ${ctx.format.inlineCode(p + "help close")} untuk detail.\n`
            + "╰┈┈┈┈┈┈┈┈୨୧",
        buttons: [
            { text: "୨୧ Buka Menu", id: `${p}menu` },
            { text: "♡ Panduan", id: `${p}help` }
        ]
    };
}

// Category picker rows for the nativeFlow list in `.menu`.
function categoryRows(ctx, extraRows = []) {
    const p = ctx.used?.prefix || ".";
    return [
        ...extraRows,
        ...CATEGORY_ORDER
            .filter(c => Object.values(COMMANDS).some(v => v[0] === c))
            .map(c => ({
                title: `♡ ${CATEGORY_LABELS[c]}`,
                description: `୨୧ ${Object.values(COMMANDS).filter(v => v[0] === c).length} perintah`,
                id: `${p}menu ${c}`
            }))
    ];
}

module.exports = {
    CATEGORY_LABELS,
    CATEGORY_ORDER,
    COMMANDS,
    SUBS,
    COMMON,
    CHATTER,
    entry,
    resolveToken,
    suggest,
    looksLikeCommand,
    detectUnknown,
    throttleUnknown,
    card,
    subCard,
    subList,
    categoryCard,
    quickStart,
    suggestCard,
    categoryRows,
    permLegend,
    header
};
