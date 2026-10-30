// backup.js — snapshot the bot's databases on demand.
//
// There was no backup path at all: alya.db, groups.json, users.json and
// telegram.json are the entire state of this bot, and they live on one disk.
// Owner-only, because the archive contains every user and group record.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const ROOT = "/root/kryznetwabot";
const OUT_DIR = path.join(ROOT, "backups");
const KEEP = 5;

// SQLite needs a consistent snapshot while the bot is writing -> use .backup
// via the sqlite3 CLI when available, else fall back to a plain copy.
const sqliteBackup = (src, dest) =>
    new Promise((resolve) => {
        execFile("sqlite3", [src, `.backup '${dest}'`], { timeout: 60_000 }, (e) =>
            resolve(!e && fs.existsSync(dest)));
    });

const mb = (n) => (n / 1048576).toFixed(1) + " MB";

module.exports = {
    name: "backup",
    aliases: ["backups"],
    category: "owner",
    description: "Buat backup database bot",
    cooldown: 10,
    code: async (ctx) => {
        if (!ctx.sender.isOwner())
            return await ctx.reply(ctx.format.info("(｡•ˇ‸ˇ•｡) Khusus owner ya~"));

        fs.mkdirSync(OUT_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const stage = path.join(OUT_DIR, `._stage-${stamp}`);
        fs.mkdirSync(stage, { recursive: true });

        const done = [];
        const failed = [];

        try {
            // 1. SQLite — consistent snapshot
            const db = path.join(ROOT, "database", "alya.db");
            if (fs.existsSync(db)) {
                const dest = path.join(stage, "alya.db");
                if (await sqliteBackup(db, dest)) done.push("alya.db");
                else failed.push("alya.db");
            }

            // 2. JSON state — copy is fine, writes are debounced
            for (const f of ["groups.json", "users.json", "telegram.json", "bot.json"]) {
                const src = path.join(ROOT, "database", f);
                if (!fs.existsSync(src)) continue;
                try {
                    fs.copyFileSync(src, path.join(stage, f));
                    done.push(f);
                } catch {
                    failed.push(f);
                }
            }

            // 3. config (contains keys — kept inside the archive, never printed)
            const cfg = path.join(ROOT, "config.json");
            if (fs.existsSync(cfg)) {
                fs.copyFileSync(cfg, path.join(stage, "config.json"));
                done.push("config.json");
            }

            if (!done.length) throw new Error("tiada fail untuk dibackup");

            // 4. tar it
            const archive = path.join(OUT_DIR, `backup-${stamp}.tar.gz`);
            fs.chmodSync(stage, 0o700);
            await new Promise((resolve, reject) => {
                execFile("tar", ["-czf", archive, "-C", stage, "."], { timeout: 300_000 }, (e) =>
                    e ? reject(e) : resolve());
            });
            fs.chmodSync(archive, 0o600);

            // 5. rotate — keep newest KEEP archives
            const archives = fs.readdirSync(OUT_DIR)
                .filter((f) => /^backup-.*\.tar\.gz$/.test(f))
                .sort()
                .reverse();
            const removed = archives.slice(KEEP);
            for (const f of removed) fs.unlinkSync(path.join(OUT_DIR, f));

            const size = fs.statSync(archive).size;
            return await ctx.reply(ctx.format.info(
                `❖ *Backup siap*\n\n` +
                `♡ Fail: ${ctx.format.inlineCode(path.basename(archive))}\n` +
                `♡ Saiz: ${mb(size)}\n` +
                `♡ Kandungan: ${done.join(", ")}` +
                (failed.length ? `\n♡ Gagal: ${failed.join(", ")}` : "") +
                `\n♡ Simpan: ${archives.length}/${KEEP} arkib`
            ));
        } catch (e) {
            return await ctx.reply(ctx.format.info(`(｡•́︿•̀｡) Backup gagal: ${e.message}`));
        } finally {
            fs.rmSync(stage, { recursive: true, force: true });
        }
    }
};
