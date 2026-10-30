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
        // Absolute: 09:00 / 21:30
        const abs = input.match(/^(\d{1,2}):(\d{2})\s+([\s\S]+)$/);

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
            const hour = parseInt(abs[1], 10);
            const minute = parseInt(abs[2], 10);
            const text = abs[3].trim();
            if (hour > 23 || minute > 59)
                return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Jam tak sah. Contoh: 09:00 atau 21:30."));
            if (!text) return await ctx.reply(ctx.format.info("(｡•́︿•̀｡) Reminder tu nak cakap apa?"));
            const id = scheduler.add({
                id: `wa_${Date.now()}`,
                chatId: ctx.id,
                platform: "whatsapp",
                text: `⏰ *Pengingat harian*\n\n${text}`,
                cron: { hour, minute, tzOffsetMin: 480 }
            });
            return await ctx.reply(ctx.format.info(
                `(｡･ω･｡) Siap! Setiap hari jam ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (GMT+8).\n♡ ${ctx.format.inlineCode(id)}`
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
