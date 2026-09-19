// tokenlimiter.js — per-user daily token limiter for AI calls
// Tracks tokens consumed per user per day. Enforces configurable limit.
// Owner: unlimited. Premium: higher default. Regular: lower default.

const STORE_PATH = "/root/kryznetwabot/database/alya.db";
let db = null;

function getDb() {
    if (db) return db;
    const { DatabaseSync } = require("node:sqlite");
    db = new DatabaseSync(STORE_PATH);
    db.exec(`
        CREATE TABLE IF NOT EXISTS token_usage (
            user_id TEXT NOT NULL,
            date TEXT NOT NULL,
            tokens INTEGER DEFAULT 0,
            PRIMARY KEY (user_id, date)
        );
        CREATE TABLE IF NOT EXISTS token_limits (
            user_id TEXT PRIMARY KEY,
            daily_limit INTEGER DEFAULT 0
        );
    `);
    return db;
}

function todayKey() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function getUsed(userId) {
    const d = getDb();
    const row = d.prepare("SELECT tokens FROM token_usage WHERE user_id = ? AND date = ?").get(String(userId), todayKey());
    return row?.tokens || 0;
}

function getLimit(userId, isOwner, isPremium) {
    if (isOwner) return 0; // 0 = unlimited
    const d = getDb();
    const row = d.prepare("SELECT daily_limit FROM token_limits WHERE user_id = ?").get(String(userId));
    if (row?.daily_limit) return row.daily_limit;
    // Defaults: premium 50k, regular 15k
    return isPremium ? 50000 : 15000;
}

function setLimit(userId, limit) {
    const d = getDb();
    d.prepare("INSERT OR REPLACE INTO token_limits (user_id, daily_limit) VALUES (?, ?)").run(String(userId), limit);
}

function getRemaining(userId, isOwner, isPremium) {
    if (isOwner) return -1; // unlimited
    const limit = getLimit(userId, isOwner, isPremium);
    const used = getUsed(userId);
    return Math.max(0, limit - used);
}

function addUsage(userId, tokens) {
    const d = getDb();
    const today = todayKey();
    d.prepare(`
        INSERT INTO token_usage (user_id, date, tokens) VALUES (?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET tokens = tokens + ?
    `).run(String(userId), today, tokens, tokens);
    return getUsed(String(userId));
}

function isLimited(userId, isOwner, isPremium) {
    if (isOwner) return { limited: false, remaining: -1 };
    const limit = getLimit(userId, isOwner, isPremium);
    const used = getUsed(userId);
    const remaining = Math.max(0, limit - used);
    return { limited: remaining <= 0, remaining, limit, used };
}

function resetUser(userId) {
    const d = getDb();
    d.prepare("DELETE FROM token_usage WHERE user_id = ?").run(String(userId));
}

function resetAll() {
    const d = getDb();
    d.prepare("DELETE FROM token_usage").run();
}

module.exports = { getUsed, getLimit, setLimit, getRemaining, addUsage, isLimited, resetUser, resetAll, todayKey };
