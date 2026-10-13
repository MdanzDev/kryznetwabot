// .pay <amount>  — create a Kryz Pay payment request
// .paystatus <reference> — check a payment's status
//
// Available to everyone in both group and private chats.
// No permissions object = no restriction by the middleware.

const kryzpay = require("../../lib/kryzpay");
const store = require("../../lib/pay-store");

const MIN_AMOUNT_SEN = 100;     // RM 1.00
const MAX_AMOUNT_SEN = 100000;  // RM 1000.00
const GATEWAY_HOST = "pg.kryz-net.space";

// Parse a user amount string into integer sen.
// Rejects: non-numeric, negative, zero, >2 decimal places, out of range.
function parseAmountSen(input) {
    if (!input || typeof input !== "string") return { error: "Masukkan amaun, contoh: .pay 10" };
    const trimmed = input.trim();
    // Must be a clean decimal: digits, optional single dot + 1-2 digits
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
        if (/^-/.test(trimmed)) return { error: "Amaun tidak boleh negatif." };
        if (/\.\d{3,}/.test(trimmed)) return { error: "Maksimum 2 tempat perpuluhan. Contoh: .pay 10.50" };
        return { error: "Amaun tidak sah. Contoh: .pay 10 atau .pay 1.50" };
    }
    // Convert to sen via integer math — never float
    const [whole, frac = ""] = trimmed.split(".");
    const sen = parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, "0"), 10);
    if (sen < MIN_AMOUNT_SEN) return { error: `Minimum RM${(MIN_AMOUNT_SEN / 100).toFixed(2)}.` };
    if (sen > MAX_AMOUNT_SEN) return { error: `Maksimum RM${(MAX_AMOUNT_SEN / 100).toFixed(2)}.` };
    return { sen };
}

module.exports = [{
    name: "pay",
    aliases: ["kryzpay", "bayar"],
    category: "misc",
    code: async (ctx) => {
        const input = ctx.text?.trim();

        // Usage
        if (!input) {
            return await ctx.reply(
                "KRYZ PAY | PAYMENT REQUEST\n\n" +
                `Cara guna: ${ctx.format.inlineCode(`${ctx.used.prefix}pay <amaun>`)}\n` +
                `Contoh: ${ctx.format.inlineCode(`${ctx.used.prefix}pay 10`)} → RM10.00\n` +
                `         ${ctx.format.inlineCode(`${ctx.used.prefix}pay 1.50`)} → RM1.50\n\n` +
                `Minimum: RM1.00 | Maksimum: RM1000.00\n` +
                `Status: ${ctx.format.inlineCode(`${ctx.used.prefix}paystatus <reference>`)}`
            );
        }

        // Validate amount
        const parsed = parseAmountSen(input);
        if (parsed.error) return await ctx.reply(`KRYZ PAY\n\n${parsed.error}`);

        const messageId = ctx.msg?.key?.id;
        if (!messageId) return await ctx.reply("Tidak dapat menentukan ID mesej. Cuba lagi.");

        const senderId = ctx.getId(ctx.sender.lid || ctx.sender.jid);
        const chatId = ctx.id;

        // Idempotency: check if this message already created a payment.
        // A retried message reuses the same key — never creates a duplicate.
        const existing = store.findByMessageId(messageId);
        if (existing) {
            // Reconcile: if the gateway already responded, replay the result.
            if (existing.payment_reference && existing.pay_url) {
                return await ctx.reply(formatPaymentCard(existing, existing.pay_url, true));
            }
            // Network result was uncertain — reconcile with the same key.
        }

        // Generate stable idempotency key from message ID.
        const idempotencyKey = `alya-pay-${messageId}`;
        const orderRef = `ALYA-${messageId.slice(-8).toUpperCase()}`;

        // Insert record before the API call so a timeout leaves a trail.
        if (!existing) {
            try {
                store.insert({ messageId, idempotencyKey, orderRef, baseAmountSen: parsed.sen, chatId, senderId });
            } catch (e) {
                // UNIQUE constraint = concurrent duplicate — re-read
                const retry = store.findByMessageId(messageId);
                if (retry?.payment_reference) return await ctx.reply(formatPaymentCard(retry, retry.pay_url, true));
            }
        }

        try {
            const result = await kryzpay.createPayment({
                amountSen: parsed.sen,
                orderRef,
                idempotencyKey
            });

            store.updateByMessageId(messageId, {
                payment_reference: result.payment.reference,
                amount_sen: result.payment.amountSen,
                amount_myr: result.payment.amountMyr,
                status: result.payment.status,
                expires_at: result.payment.expiresAt,
                pay_url: result.payUrl
            });

            await ctx.reply(formatPaymentCard({
                base_amount_sen: parsed.sen,
                amount_myr: result.payment.amountMyr,
                payment_reference: result.payment.reference,
                status: result.payment.status,
                expires_at: result.payment.expiresAt
            }, result.payUrl, result.idempotentReplay));
        } catch (error) {
            console.error("[pay] gateway error:", error.message);
            store.updateByMessageId(messageId, { status: "failed" });
            await ctx.reply(`KRYZ PAY\n\n${error.message}`);
        }
    }
}, {
    name: "paystatus",
    aliases: ["paystatus", "cekpay"],
    category: "misc",
    code: async (ctx) => {
        const reference = ctx.text?.trim()?.toUpperCase();
        if (!reference) {
            return await ctx.reply(
                `KRYZ PAY\n\nCara guna: ${ctx.format.inlineCode(`${ctx.used.prefix}paystatus <reference>`)}\n` +
                `Contoh: ${ctx.format.inlineCode(`${ctx.used.prefix}paystatus PG-2B1697D2`)}`
            );
        }

        const senderId = ctx.getId(ctx.sender.lid || ctx.sender.jid);

        // Ownership check: must be the person who created this payment.
        const local = store.findByReference(reference, senderId);
        if (!local) {
            return await ctx.reply(
                `KRYZ PAY\n\nPayment ${ctx.format.inlineCode(reference)} tidak dijumpai dalam rekod kau. ` +
                `Pastikan reference betul dan kau yang create payment ni.`
            );
        }

        try {
            const payment = await kryzpay.getPayment(reference);
            // Update local status
            store.updateByMessageId(local.message_id, { status: payment.status });

            const expiryNote = payment.status === "received"
                ? "Pembayaran diterima."
                : payment.status === "expired"
                ? "Link dah expired."
                : `Link expired: ${payment.expiresAt}`;

            const verificationNote =
                payment.verification === "notification_only"
                    ? "\n\nNota: 'notification_only' bermaksud gateway kesan notifikasi TNG yang sepadan. Ia bukan bukti identiti pembayar."
                    : "";

            await ctx.reply(
                `KRYZ PAY | PAYMENT STATUS\n\n` +
                `Reference: ${payment.reference}\n` +
                `Status: ${payment.status.toUpperCase()}\n` +
                `Amount: RM${payment.amountMyr}\n` +
                `Base: RM${payment.baseAmountMyr}\n` +
                `Order: ${payment.orderRef}\n` +
                `${expiryNote}${verificationNote}`
            );
        } catch (error) {
            console.error("[paystatus] error:", error.message);
            await ctx.reply(`KRYZ PAY\n\n${error.message}`);
        }
    }
}];

function formatPaymentCard(rec, payUrl, isReplay) {
    const baseMyr = (rec.base_amount_sen / 100).toFixed(2);
    return (
        "KRYZ PAY | PAYMENT REQUEST\n\n" +
        `Amount: RM${baseMyr}\n` +
        `Total to pay: RM${rec.amount_myr}\n` +
        `Reference: ${rec.payment_reference}\n` +
        `Status: ${rec.status ? rec.status.charAt(0).toUpperCase() + rec.status.slice(1) : "Pending"}\n\n` +
        `Pay here:\n${payUrl}\n\n` +
        `This payment link expires in 10 minutes. Transfer the exact amount shown on the checkout page.` +
        (isReplay ? "\n\n(Replay: payment ni dah dibuat sebelum ni.)" : "")
    );
}
