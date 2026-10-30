// remind.js — personal reminders on WhatsApp, delivered back to the chat that
// created them.
//
// Deliberately NOT owner-gated: the Telegram /remind is owner-only because it
// can run arbitrary text against a system brain; this one only ever echoes the
// text the user themselves wrote, so anyone may use it.
//
// Delivery goes through the shared Scheduler (lib/telegram/scheduler.js) with a
// "whatsapp" channel registered in main.js, so a WA reminder never lands on
// Telegram and survives a bot restart (jobs persist in database/telegram.json).
// ── weekday parsing for ".remind mon-fri 08:00 ..." ──
// Cron uses 1=Mon..7=Sun (Sunday normalised to 7 by the Scheduler).
const DAY_NAMES = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" };
const DAY_ALIASES = {
    mon: 1, monday: 1, isnin: 1, senin: 1,
    tue: 2, tues: 2, tuesday: 2, selasa: 2,
    wed: 3, weds: 3, wednesday: 3, rabu: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4, khamis: 4, kamis: 4,
    fri: 5, friday: 5, jumaat: 5, jumat: 5,
    sat: 6, saturday: 6, sabtu: 6,
    sun: 7, sunday: 7, ahad: 7, minggu: 7
};

// "mon-fri" | "sabtu" | "mon,wed,fri" | "weekdays" -> [1,2,3,4,5] | null
function parseDays(spec) {
    const s = String(spec || "").toLowerCase().trim();
    if (!s) return null;
    if (/^(weekday|weekdays|hari\s*kerja)$/.test(s)) return [1, 2, 3, 4, 5];
    if (/^(weekend|weekends|hujung\s*minggu)$/.test(s)) return [6, 7];
    if (/^(everyday|daily|harian|semua)$/.test(s)) return null; // = every day

    const out = new Set();
    for (const part of s.split(",")) {
        const p = part.trim();
        if (!p) continue;
        const range = p.match(/^([a-z]+)\s*-\s*([a-z]+)$/);
        if (range) {
            const a = DAY_ALIASES[range[1]];
            const b = DAY_ALIASES[range[2]];
            if (!a || !b) return null;
            // Wrap around: fri-mon is legal.
            for (let d = a; ; d = d % 7 + 1) {
                out.add(d);
                if (d === b) break;
                if (out.size > 7) return null;
            }
        } else {
            const d = DAY_ALIASES[p];
            if (!d) return null;
            out.add(d);
        }
    }
    return out.size ? [...out].sort((x, y) => x - y) : null;
}

module.exports = {
    name: "remind",
    aliases: ["reminder", "ingat", "ingatkan"],
    category: "tool",
    description: "Set a reminder — .remind 30m minum air / .remind 2h / .remind 09:00 solat",
    cooldown: 3,
    code: async (ctx) => {
        const p = ctx.used?.prefix || ".";
        const scheduler = ctx.bot?.waAlya?.tg?.scheduler;
        if (!scheduler) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Scheduler tak aktif."));

        const input = String(ctx.text || "").trim();

        // .remind list
        if (/^(list|senarai|ls)$/i.test(input)) {
            const jobs = scheduler.list(ctx.id).filter((j) => j.platform === "whatsapp");
            if (!jobs.length) return await ctx.reply(ctx.format.info("(｡･ω･｡) Belum ada reminder."));
            const lines = jobs.slice(0, 15).map((j) => {
                const when = j.at ? new Date(j.at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })
                    : `setiap hari ${String(j.cron.hour).padStart(2, "0")}:${String(j.cron.minute).padStart(2, "0")}`;
                return `♡ ${ctx.format.inlineCode(j.id)} · ${when}\n   ${String(j.text).slice(0, 60)}`;
            });
            return await ctx.reply(ctx.format.info(`❖ Reminder kamu (${jobs.length})\n\n${lines.join("\n")}\n\n♡ Padam: ${p}remind del <id>`));
        }

        // .remind del <id>
        const del = input.match(/^(?:del|delete|hapus|buang)\s+(\S+)$/i);
        if (del) {
            const ok = scheduler.remove(del[1], ctx.id);
            return await ctx.reply(ctx.format.info(ok
                ? "(｡･ω･｡) Reminder dah dipadam."
                : "(｡•́︿•̀｡) Tak jumpa reminder tu."));
        }

        // .remind snooze <id> <durasi>
        const sn = input.match(/^snooze\s+(\S+)\s+(\d+)\s*(m|min|minit|h|jam|d|hari)?$/i);
        if (sn) {
            const job = scheduler.list(ctx.id).find((j) => j.id === sn[1]);
            if (!job) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Tak jumpa reminder tu."));
            const n = parseInt(sn[2], 10);
            const unit = (sn[3] || "m").toLowerCase();
            const ms = unit.startsWith("m") ? 60_000 : (unit === "h" || unit === "jam") ? 3_600_000 : 86_400_000;
            const at = Date.now() + n * ms;
            // Mutate in place so the id stays stable, then persist.
            job.at = at;
            if (job.cron) delete job.cron;
            job._lastFire = null;
            scheduler.state.set("reminders", scheduler.jobs);
            const when = new Date(at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" });
            return await ctx.reply(ctx.format.info(`(｡･ω･｡) Reminder ditangguh ke ${when} (MYT).`));
        }

        if (!input) {
            return await ctx.reply(ctx.format.info(
                `❖ Cara guna ${p}remind\n\n` +
                `♡ ${p}remind 30m minum air\n` +
                `♡ ${p}remind 2h cek server\n` +
                `♡ ${p}remind 09:00 solat subuh  (setiap hari)\n` +
                `♡ ${p}remind list\n` +
                `♡ ${p}remind del <id>`
            ));
        }

        // Relative: 30m / 2h / 3d
        const rel = input.match(/^(\d+)\s*(m|min|minit|h|jam|d|hari)\s+([\s\S]+)$/i);
        // Absolute: 09:00 / 21:30, optionally prefixed with weekdays
        const abs = input.match(/^(?:([a-z,\-\s]+?)\s+)?(\d{1,2}):(\d{2})\s+([\s\S]+)$/i);

        if (rel) {
            const n = parseInt(rel[1], 10);
            const unit = rel[2].toLowerCase();
            const ms = unit.startsWith("m") ? 60_000 : (unit === "h" || unit === "jam") ? 3_600_000 : 86_400_000;
            const text = rel[3].trim();
            if (!text) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Reminder tu nak cakap apa?"));
            const at = Date.now() + n * ms;
            const id = scheduler.add({
                id: `wa_${Date.now()}`,
                chatId: ctx.id,
                platform: "whatsapp",
                text: `⏰ *Pengingat*\n\n${text}`,
                at,
                once: true
            });
            const when = new Date(at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" });
            return await ctx.reply(ctx.format.info(
                `(｡･ω･｡) Siap! Aku ingatkan ${when} (MYT).\n♡ ${ctx.format.inlineCode(id)}`
            ));
        }

        if (abs) {
            const daySpec = abs[1];
            const hour = parseInt(abs[2], 10);
            const minute = parseInt(abs[3], 10);
            const text = abs[4].trim();
            if (hour > 23 || minute > 59)
                return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Jam tak sah. Contoh: 09:00 atau 21:30."));
            if (!text) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Reminder tu nak cakap apa?"));

            let days;
            if (daySpec) {
                days = parseDays(daySpec);
                if (!days)
                    return await ctx.reply(ctx.format.info(
                        "(｡•́︿•̀｡) Hari tak faham.\n\n♡ Contoh: mon-fri, sabtu, mon,wed,fri"
                    ));
            }

            const id = scheduler.add({
                id: `wa_${Date.now()}`,
                chatId: ctx.id,
                platform: "whatsapp",
                text: `⏰ *Pengingat harian*\n\n${text}`,
                cron: { hour, minute, tzOffsetMin: 480, ...(days ? { days } : {}) }
            });
            const dayLabel = days ? ` (${days.map((d) => DAY_NAMES[d]).join(", ")})` : "";
            return await ctx.reply(ctx.format.info(
                `(｡･ω･｡) Siap! Setiap hari${dayLabel} jam ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (GMT+8).\n♡ ${ctx.format.inlineCode(id)}`
            ));
        }

        return await ctx.reply(ctx.format.info(
            `(｡•́︿•̀｡) Format tak faham.\n\n` +
            `♡ ${p}remind 30m minum air\n` +
            `♡ ${p}remind 09:00 solat\n\n` +
            `(minit: m/min · jam: h/jam · hari: d/hari)`
        ));
    }
};
