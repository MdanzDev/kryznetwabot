const moment = require("moment-timezone");

function bold(text) {
    return `*${text}*`;
}

// Parse a plain duration like "30m", "2j", "1h30m", "45 minit" into ms.
// Deliberately stricter than nl-remind's parser: no reminder verb, no clock
// times, and a hard upper bound, so it cannot be confused with chat text.
// Returns null when unparseable.
const DURATION_UNITS = [
    { re: /^(\d+(?:\.\d+)?)\s*(?:minggu|weeks?|w)\b/i, ms: 604_800_000 },
    { re: /^(\d+(?:\.\d+)?)\s*(?:hari|days?|d)\b/i, ms: 86_400_000 },
    { re: /^(\d+(?:\.\d+)?)\s*(?:jam|hours?|hrs?|j|h)(?![a-z])/i, ms: 3_600_000 },
    { re: /^(\d+(?:\.\d+)?)\s*(?:minit|minutes?|mins?|m)(?![a-z])/i, ms: 60_000 },
    { re: /^(\d+(?:\.\d+)?)\s*(?:saat|detik|seconds?|secs?|s)(?![a-z])/i, ms: 1_000 }
];
const DURATION_MAX_MS = 7 * 86_400_000; // a week is plenty for a timer

function parseDuration(input) {
    let rest = String(input || "").trim().toLowerCase().replace(/\s+/g, " ");

    // A bare number means minutes — the natural unit for a timer.
    if (/^\d+$/.test(rest)) return clampDuration(parseInt(rest, 10) * 60_000);

    let total = 0;
    let matched = false;

    // Consume unit segments left to right, so "1h30m" works.
    while (rest.length) {
        let hit = null;
        for (const u of DURATION_UNITS) {
            const m = rest.match(u.re);
            if (m) { hit = { m, u }; break; }
        }
        if (!hit) break;
        const n = parseFloat(hit.m[1]);
        if (!Number.isFinite(n) || n <= 0) return null;
        total += n * hit.u.ms;
        matched = true;
        rest = rest.slice(hit.m[0].length).replace(/^[\s,]+/, "");
    }

    if (!matched || rest.length) return null; // trailing junk -> reject
    return clampDuration(total);
}

function clampDuration(ms) {
    if (!Number.isFinite(ms) || ms < 60_000) return null;        // under a minute is a typo
    if (ms > DURATION_MAX_MS) return DURATION_MAX_MS;            // cap, don't reject
    return Math.round(ms);
}

function convertMsToDuration(ms, requestedParts = null) {
    if (!ms || ms <= 0) return "0 detik";

    const duration = moment.duration(ms);
    const hasLargerUnits = duration.asSeconds() >= 1;
    const units = {
        tahun: {
            value: duration.years(),
            condition: duration.years() > 0
        },
        bulan: {
            value: duration.months(),
            condition: duration.months() > 0
        },
        minggu: {
            value: duration.weeks(),
            condition: duration.weeks() > 0
        },
        hari: {
            value: duration.days(),
            condition: duration.days() > 0
        },
        jam: {
            value: duration.hours(),
            condition: duration.hours() > 0
        },
        menit: {
            value: duration.minutes(),
            condition: duration.minutes() > 0
        },
        detik: {
            value: duration.seconds(),
            condition: duration.seconds() > 0
        },
        milidetik: {
            value: duration.milliseconds(),
            condition: duration.milliseconds() > 0
        }
    };

    const parts = [];
    if (requestedParts && Array.isArray(requestedParts)) {
        for (const part of requestedParts) {
            if (units[part]) parts.push(`${units[part].value} ${part}`);
        }
    } else {
        for (const [unit, data] of Object.entries(units)) {
            if (unit === "milidetik") {
                if (!hasLargerUnits && data.value > 0) parts.push(`${data.value} ${unit}`);
            } else if (data.condition) {
                parts.push(`${data.value} ${unit}`);
            }
        }
    }
    return parts.length > 0 ? parts.join(" ") : "0 detik";
}

function formatSize(byteCount, withPerSecond = false) {
    if (!byteCount) return `0 yBytes${withPerSecond ? "/s" : ""}`;

    let index = 8;
    let size = byteCount;
    const bytes = ["yBytes", "zBytes", "aBytes", "fBytes", "pBytes", "nBytes", "µBytes", "mBytes", "Bytes", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];

    while (size < 1 && index > 0) {
        size *= 1024;
        index--;
    }
    while (size >= 1024 && index < bytes.length - 1) {
        size /= 1024;
        index++;
    }

    return `${size.toFixed(2)} ${bytes[index]}${withPerSecond ? "/s" : ""}`;
}

function generateCmdExample(used, args) {
    if (!used || !args) return `${inlineCode("used")} atau ${inlineCode("args")} harus diberikan!`;
    return "╭┈┈┈┈┈┈┈┈୨୧\n" +
        "┊ ✦ 𝑪𝒐𝒏𝒕𝒐𝒉 𝑷𝒆𝒏𝒈𝒈𝒖𝒏𝒂𝒂𝒏 ୨୧\n" +
        `┊ ❖ ${inlineCode(`${used.prefix + used.command} ${args}`)}\n` +
        "╰┈┈┈┈┈┈┈┈୨୧";
}

function generateInstruction(actions, mediaTypes) {
    if (!actions || !mediaTypes || !Array.isArray(actions) || !Array.isArray(mediaTypes)) return `${inlineCode("actions")} dan ${inlineCode("mediaTypes")} harus berupa array!`;

    const mediaTypeTranslations = {
        audio: "audio",
        document: "dokumen",
        image: "gambar",
        sticker: "stiker",
        text: "teks",
        video: "video",
        viewOnce: "sekali lihat"
    };
    const translatedMediaTypeList = mediaTypes.map(type => mediaTypeTranslations[type] || type);
    let mediaTypesList;
    if (translatedMediaTypeList.length > 1) {
        const lastMediaType = translatedMediaTypeList[translatedMediaTypeList.length - 1];
        mediaTypesList = `${translatedMediaTypeList.slice(0, -1).join(", ")} atau ${lastMediaType}`;
    } else {
        mediaTypesList = translatedMediaTypeList[0];
    }

    const actionTranslations = {
        send: "Kirim",
        reply: "Balas"
    };
    const instructions = actions.map(action => `${actionTranslations[action] || action}`);
    const actionList = instructions.join(actions.length > 1 ? " atau " : "");

    return "╭───────────────୨୧\n" +
        "│  ₊˚⊹♡  𝑷𝒆𝒕𝒖𝒏𝒋𝒖𝒌  ♡⊹˚₊\n" +
        `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა Silakan ${actionList.toLowerCase()} ${mediaTypesList} ya~ ♡\n` +
        "╰───────────────୨୧";
}

function generatesFlagInfo(flags) {
    if (!flags || typeof flags !== "object") return `${inlineCode("flags")} harus berupa objek!`;
    return "╭┈┈┈┈┈┈┈┈୨୧\n" +
        "┊ ✦ 𝑶𝒑𝒔𝒊 / 𝑭𝒍𝒂𝒈 ୨୧\n" +
        Object.entries(flags).map(([flag, description]) => `┊ ❖ ${inlineCode(flag)} › ${description}`).join("\n") + "\n" +
        "╰┈┈┈┈┈┈┈┈୨୧";
}

function generateNotes(notes) {
    if (!notes || !Array.isArray(notes)) return `${inlineCode("notes")} harus berupa array!`;
    return "╭┈┈┈┈┈┈┈┈୨୧\n" +
        "┊ ✦ 𝑪𝒂𝒕𝒂𝒕𝒂𝒏 ୨୧\n" +
        notes.map(note => `┊ ♡ ${note}`).join("\n") + "\n" +
        "╰┈┈┈┈┈┈┈┈୨୧";
}

const kaomoji = {
    happy: "૮ ˶ᵔ ᵕ ᵔ˶ ა",
    love: "(｡･ω･｡)ﾉ♡",
    wink: "(｡•̀ᴗ-)✧",
    sad: "(｡•́︿•̀｡)",
    crying: "(╥﹏╥)",
    hug: "(づ｡◕‿‿◕｡)づ",
    pout: "(｡•ˇ‸ˇ•｡)",
    sleep: "(－ω－) zzZ",
    think: "(・_・;)",
    sparkle: "₊˚⊹♡"
};

function info(text) {
    if (!text) return "";
    const str = String(text).trim();
    if (str.startsWith("╭───────────────୨୧") || str.startsWith("╭┈┈┈┈┈┈┈┈୨୧")) return str;

    const hasKaomoji = /[\(（][^()]+[\)）]|૮|づ|✧|♡|୨୧/.test(str);
    let cuteBody = str;
    if (!hasKaomoji) {
        if (/gagal|error|salah|kurang|tidak|bukan|jangan|invalid|habis|terpaksa|dilarang|warning/i.test(str)) {
            cuteBody = `(｡•́︿•̀｡) ${str}~`;
        } else if (/berhasil|selamat|benar|sukses|win|mantap|aktif|tersimpan/i.test(str)) {
            cuteBody = `૮ ˶ᵔ ᵕ ᵔ˶ ა ${str}! ♡`;
        } else if (/tunggu|proses|sedang|memulai|mengambil|menguji|mencari/i.test(str)) {
            cuteBody = `(｡･ω･｡) ${str}~ ✧`;
        } else {
            cuteBody = `(｡･ω･｡)ﾉ♡ ${str}~`;
        }
    }

    const lines = cuteBody.split("\n");
    const boxed = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return "│";
        const formatted = trimmed.startsWith("_") && trimmed.endsWith("_") ? trimmed : italic(trimmed);
        return `│ ♡ ${formatted}`;
    }).join("\n");
    return `╭───────────────୨୧\n${boxed}\n╰───────────────୨୧`;
}

function card({ title, subtitle, sections = [], notes, footer }) {
    let result = "";
    if (title) {
        result += "╭───────────────୨୧\n" +
                  `│  ₊˚⊹♡  ${title}  ♡⊹˚₊\n`;
        if (subtitle) result += `│ ${subtitle}\n`;
        result += "╰───────────────୨୧\n\n";
    }
    for (const section of sections) {
        result += "╭┈┈┈┈┈┈┈┈୨୧\n" +
                  `┊ ✦ ${section.title} ୨୧\n`;
        if (section.items && Array.isArray(section.items)) {
            for (const item of section.items) {
                result += `┊ ${item}\n`;
            }
        }
        result += "╰┈┈┈┈┈┈┈┈୨୧\n\n";
    }
    if (notes) {
        result += "╭┈┈┈┈┈┈┈┈୨୧\n" +
                  "┊ ✦ 𝑪𝒂𝒕𝒂𝒕𝒂𝒏 ୨୧\n" +
                  (Array.isArray(notes) ? notes.map(n => `┊ ♡ ${n}`).join("\n") : `┊ ♡ ${notes}`) + "\n" +
                  "╰┈┈┈┈┈┈┈┈୨୧\n\n";
    }
    if (footer) {
        result += "╭───────────────୨୧\n" +
                  `│ ${footer}\n` +
                  "╰───────────────୨୧";
    }
    return result.trim();
}

function inlineCode(text) {
    return `\`${text}\``;
}

function italic(text) {
    return `_${text}_`;
}

function monospace(text) {
    return `\`\`\`${text}\`\`\``;
}

function quote(text) {
    return `> ${text}`;
}

function strikethrough(text) {
    return `~${text}~`;
}

function ucwords(text) {
    if (!text) return null;
    return text.toLowerCase().replace(/\b\w/g, (txt) => txt.toUpperCase());
}

module.exports = {
    bold,
    card,
    convertMsToDuration,
    parseDuration,
    formatSize,
    generateCmdExample,
    generateInstruction,
    generatesFlagInfo,
    generateNotes,
    info,
    inlineCode,
    italic,
    kaomoji,
    monospace,
    quote,
    strikethrough,
    ucwords
};