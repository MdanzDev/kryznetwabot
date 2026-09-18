// browser.js — Playwright-powered web browsing for Alya.
// Browse pages, extract readable text, take screenshots, fill forms.
// Search uses the existing HTTP-based webSearch() (bot already has it).
// The browser is for READING pages and INTERACTING (clicks, forms).
//
// Lazy-launches chromium and closes it after each request to stay
// within the 1GB RAM budget.

const { chromium } = require("playwright-core");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

// Auto-detect the newest cached chromium (npx playwright install may bump
// versions and DELETE old ones — never hardcode a single version).
function detectChromium() {
    const cacheDir = "/root/.cache/ms-playwright";
    try {
        const dirs = fs.readdirSync(cacheDir)
            .filter(d => /^chromium-\d+$/.test(d))
            .sort((a, b) => parseInt(b.slice(9)) - parseInt(a.slice(9))); // newest first
        for (const d of dirs) {
            for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
                const p = path.join(cacheDir, d, sub);
                if (fs.existsSync(p)) return p;
            }
        }
    } catch {}
    return null;
}
const NAV_TIMEOUT = 30000;
const MAX_TEXT = 8000;

class Browser {
    constructor() {
        this.browser = null;
        this.launching = null;
    }

    async _launch() {
        if (this.browser && this.browser.isConnected()) return this.browser;
        if (this.launching) return this.launching;
        this.launching = (async () => {
            try {
                const executablePath = detectChromium();
                if (!executablePath) throw new Error("No chromium found in /root/.cache/ms-playwright — run: npx playwright install chromium");
                this.browser = await chromium.launch({
                    executablePath,
                    headless: true,
                    args: [
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--disable-extensions",
                        "--disable-background-networking",
                        "--no-first-run",
                        "--disable-default-apps"
                    ]
                });
                return this.browser;
            } finally {
                this.launching = null;
            }
        })();
        return this.launching;
    }

    async _close() {
        if (this.browser) {
            try { await this.browser.close(); } catch {}
            this.browser = null;
        }
    }

    // ---- SEARCH: DuckDuckGo instant answer API (HTTP, no browser needed) ----
    // Returns { results: [{title, url, snippet}] } or { answer: "..." }
    async search(query, { maxResults = 8 } = {}) {
        // DuckDuckGo instant answer API — no bot detection
        const ddgUrl = `https://api.duckduckgo.com/?${new URLSearchParams({ q: query, format: "json", no_html: "1", no_redirect: "1" })}`;
        const ddg = await this._getJSON(ddgUrl);
        const results = [];

        // Direct answer
        if (ddg?.AbstractText) {
            results.push({ title: ddg.Heading || query, url: ddg.AbstractURL || "", snippet: ddg.AbstractText, answer: true });
        }

        // Related topics
        if (ddg?.RelatedTopics) {
            for (const topic of ddg.RelatedTopics) {
                if (topic.Text) {
                    results.push({ title: topic.FirstURL ? topic.Text.split(" - ")[0] : topic.Text.slice(0, 80), url: topic.FirstURL || "", snippet: topic.Text.slice(0, 300) });
                }
                if (results.length >= maxResults) break;
            }
        }

        // Also try Wikipedia search (already proven to work)
        if (results.length < 3) {
            const wikiHits = await this._wikiSearch(query, "en", 5);
            for (const hit of wikiHits) {
                results.push({ title: hit.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`, snippet: (hit.snippet || "").replace(/<[^>]+>/g, "").slice(0, 300) });
                if (results.length >= maxResults) break;
            }
        }

        return { results: results.slice(0, maxResults), query };
    }

    async _getJSON(urlString, timeoutMs = 15000) {
        try {
            const { status, buffer } = await this._request(urlString, { timeoutMs });
            return JSON.parse(buffer.toString("utf8"));
        } catch { return null; }
    }

    _request(urlString, { method = "GET", timeoutMs = 15000 } = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlString);
            const req = https.request({
                hostname: url.hostname, path: url.pathname + url.search, method,
                headers: { "User-Agent": "AlyaBot/1.0" }, timeout: timeoutMs
            }, (res) => {
                const chunks = [];
                res.on("data", c => chunks.push(c));
                res.on("end", () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
            });
            req.on("timeout", () => req.destroy(new Error("timeout")));
            req.on("error", reject);
            req.end();
        });
    }

    async _wikiSearch(query, lang, limit) {
        const url = `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ action: "query", list: "search", srsearch: query, format: "json", utf8: "1", srlimit: String(limit) })}`;
        const data = await this._getJSON(url);
        return data?.query?.search || [];
    }

    // ---- BROWSE: open a URL and return readable text + title ----
    async browse(url, { maxText = MAX_TEXT, waitMs = 2000 } = {}) {
        const browser = await this._launch();
        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
            if (waitMs) await page.waitForTimeout(waitMs).catch(() => {});
            const data = await page.evaluate(() => {
                const clone = document.body ? document.body.cloneNode(true) : null;
                if (!clone) return { title: document.title, text: "" };
                clone.querySelectorAll("script,style,noscript,nav,footer,header,aside,iframe,form,button").forEach(el => el.remove());
                let text = clone.innerText || clone.textContent || "";
                return { title: document.title, url: location.href, text: text.replace(/\s{3,}/g, "\n").replace(/\n{3,}/g, "\n\n").trim() };
            });
            if (data.text.length > maxText) data.text = data.text.slice(0, maxText) + "\n...[truncated]";
            return data;
        } catch (e) {
            return { error: e.message };
        } finally {
            await page.close().catch(() => {});
            await this._close();
        }
    }

    // ---- CLICK: open URL, click a selector, return resulting text ----
    async click(url, selector, { maxText = MAX_TEXT } = {}) {
        const browser = await this._launch();
        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
            await page.waitForTimeout(1000).catch(() => {});
            await page.click(selector, { timeout: 10000 });
            await page.waitForTimeout(2000).catch(() => {});
            const text = await page.evaluate(() => document.body.innerText);
            return { title: await page.title(), text: text.replace(/\s{3,}/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxText) };
        } catch (e) {
            return { error: e.message };
        } finally {
            await page.close().catch(() => {});
            await this._close();
        }
    }

    // ---- SCREENSHOT: capture a page as PNG buffer ----
    async screenshot(url, { fullPage = false } = {}) {
        const browser = await this._launch();
        const page = await browser.newPage();
        try {
            await page.setViewportSize({ width: 1280, height: 800 });
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
            await page.waitForTimeout(2000).catch(() => {});
            const buffer = await page.screenshot({ fullPage, type: "png" });
            return { buffer, title: await page.title() };
        } catch (e) {
            return { error: e.message };
        } finally {
            await page.close().catch(() => {});
            await this._close();
        }
    }

    // ---- FILL FORM: open URL, fill a form, submit, return result text ----
    async fillForm(url, fields, { submit = true, maxText = MAX_TEXT } = {}) {
        const browser = await this._launch();
        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
            await page.waitForTimeout(1000).catch(() => {});
            for (const [selector, value] of Object.entries(fields)) {
                await page.fill(selector, value).catch(() => {});
            }
            if (submit) {
                await page.keyboard.press("Enter").catch(() => {});
                await page.waitForTimeout(2000).catch(() => {});
            }
            const text = await page.evaluate(() => document.body.innerText);
            return { title: await page.title(), text: text.replace(/\s{3,}/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxText) };
        } catch (e) {
            return { error: e.message };
        } finally {
            await page.close().catch(() => {});
            await this._close();
        }
    }
}

let instance = null;
function getBrowser() {
    if (!instance) instance = new Browser();
    return instance;
}

module.exports = { Browser, getBrowser };
