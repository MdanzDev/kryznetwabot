// kryzpay.js — Kryz Pay gateway API wrapper
//
// Creates payments and checks their status via the Kryz Pay API.
// Reads the API key from env var KRYZ_PAY_API_KEY — never hardcoded.
//
// All amounts are in SEN (positive integers). The gateway adds a unique
// 1-99 sen offset to the base amount so concurrent payments never collide.
// amount_myr in the response is the ACTUAL payable total (base + offset).

const axios = require("axios");

const BASE_URL = "https://pg.kryz-net.space/api/v1";
const GATEWAY_HOST = "pg.kryz-net.space";
const REQUEST_TIMEOUT = 20000;

function apiKey() {
    const key = process.env.KRYZ_PAY_API_KEY;
    if (!key) throw new Error("KRYZ_PAY_API_KEY is not set");
    return key;
}

function authHeaders(idempotencyKey) {
    const h = {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json"
    };
    if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
    return h;
}

// Validate that a pay_url is safe to share — exact hostname, HTTPS only.
function isValidPayUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === "https:" && u.hostname === GATEWAY_HOST;
    } catch {
        return false;
    }
}

// Map gateway HTTP status codes to user-facing messages.
function gatewayError(status, body) {
    const msg = body?.error?.message || body?.error || body?.message || `Gateway error (${status})`;
    if (status === 400) return { status, message: `Permintaan tidak sah: ${msg}` };
    if (status === 401) return { status, message: "API key tidak sah atau expired. Hubungi owner." };
    if (status === 403) return { status, message: "Akses dinafikan: akaun tidak aktif atau scope tidak mencukupi." };
    if (status === 404) return { status, message: `Payment tidak dijumpai: ${msg}` };
    if (status === 409) return { status, message: "Amaun ni sibuk sekarang (semua offset sen dah diambil). Cuba semula dalam 15-30 saat.", retry: true };
    if (status >= 500) return { status, message: "Gateway error. Cuba semula sebentar." };
    return { status, message: msg };
}

// Create a payment. Returns { payment, pay_url, idempotent_replay } or throws.
async function createPayment({ amountSen, orderRef, idempotencyKey }) {
    const r = await axios.post(`${BASE_URL}/payments`, {
        amount_sen: amountSen,
        order_ref: orderRef
    }, {
        headers: authHeaders(idempotencyKey),
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true
    });

    if (r.status >= 400) {
        const err = gatewayError(r.status, r.data);
        const e = new Error(err.message);
        e.gatewayStatus = err.status;
        e.retry = err.retry;
        throw e;
    }

    const payment = r.data?.payment;
    const payUrl = r.data?.pay_url;
    if (!payment?.reference) throw new Error("Gateway returned no payment reference");
    if (!isValidPayUrl(payUrl)) throw new Error("Gateway returned an invalid checkout URL");

    return {
        payment: {
            reference: payment.reference,
            amountSen: payment.amount_sen,
            amountMyr: payment.amount_myr,
            baseAmountSen: payment.base_amount_sen,
            baseAmountMyr: payment.base_amount_myr,
            offsetSen: payment.offset_sen,
            status: payment.status,
            verification: payment.verification,
            orderRef: payment.order_ref,
            expiresAt: payment.expires_at,
            createdAt: payment.created_at
        },
        payUrl,
        idempotentReplay: Boolean(r.data?.idempotent_replay)
    };
}

// Check payment status by reference. Returns { payment } or throws.
async function getPayment(reference) {
    const r = await axios.get(`${BASE_URL}/payments/${encodeURIComponent(reference)}`, {
        headers: authHeaders(),
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true
    });

    if (r.status >= 400) {
        const err = gatewayError(r.status, r.data);
        const e = new Error(err.message);
        e.gatewayStatus = err.status;
        throw e;
    }

    const payment = r.data?.payment;
    if (!payment) throw new Error("Gateway returned no payment data");

    return {
        reference: payment.reference,
        amountSen: payment.amount_sen,
        amountMyr: payment.amount_myr,
        baseAmountSen: payment.base_amount_sen,
        baseAmountMyr: payment.base_amount_myr,
        offsetSen: payment.offset_sen,
        status: payment.status,
        verification: payment.verification,
        orderRef: payment.order_ref,
        expiresAt: payment.expires_at,
        createdAt: payment.created_at,
        updatedAt: payment.updated_at
    };
}

module.exports = {
    createPayment,
    getPayment,
    isValidPayUrl,
    gatewayError,
    GATEWAY_HOST,
    BASE_URL
};
