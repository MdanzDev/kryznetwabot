// pay-store.js — minimal persistence for payment records.
//
// Uses node:sqlite (built into Node 22+) — same as the existing Store in
// lib/telegram/store.js. Zero deps.
//
// Stores the originating WA message ID as the idempotency anchor so a retried
// message reuses the same gateway idempotency key and never creates a duplicate.
// Ownership: every record is bound to (chatId, senderId) so .paystatus can
// refuse to show a payment to someone who didn't create it.

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

const DB_PATH = path.join(__dirname, "..", "database", "alya.db");
let db = null;

function getDb() {
    if (!db) {
        db = new DatabaseSync(DB_PATH);
        db.exec("PRAGMA journal_mode = WAL");
        db.exec(`
            CREATE TABLE IF NOT EXISTS kryzpay_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL,
                idempotency_key TEXT NOT NULL UNIQUE,
                order_ref TEXT NOT NULL,
                payment_reference TEXT,
                base_amount_sen INTEGER NOT NULL,
                amount_sen INTEGER,
                amount_myr TEXT,
                status TEXT NOT NULL DEFAULT 'created',
                chat_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at TEXT,
                pay_url TEXT
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_kryzpay_msg ON kryzpay_orders(message_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_kryzpay_ref ON kryzpay_orders(payment_reference)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_kryzpay_sender ON kryzpay_orders(sender_id)`);
    }
    return db;
}

// Find an existing order by message ID — used to detect a retried message.
function findByMessageId(messageId) {
    return getDb().prepare("SELECT * FROM kryzpay_orders WHERE message_id = ?").get(messageId);
}

// Insert a new order record.
function insert({ messageId, idempotencyKey, orderRef, baseAmountSen, chatId, senderId }) {
    getDb().prepare(
        `INSERT INTO kryzpay_orders
         (message_id, idempotency_key, order_ref, base_amount_sen, status, chat_id, sender_id, created_at)
         VALUES (?, ?, ?, ?, 'created', ?, ?, ?)`
    ).run(messageId, idempotencyKey, orderRef, baseAmountSen, chatId, senderId, Date.now());
    return findByMessageId(messageId);
}

// Update a record after the gateway responds.
function updateByMessageId(messageId, fields) {
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
    }
    if (!sets.length) return;
    vals.push(messageId);
    getDb().prepare(`UPDATE kryzpay_orders SET ${sets.join(", ")} WHERE message_id = ?`).run(...vals);
}

// Find by payment reference — used by .paystatus. Checks ownership.
function findByReference(reference, senderId) {
    return getDb().prepare(
        "SELECT * FROM kryzpay_orders WHERE payment_reference = ? AND sender_id = ?"
    ).get(reference, senderId);
}

module.exports = {
    findByMessageId,
    insert,
    updateByMessageId,
    findByReference,
    getDb
};
