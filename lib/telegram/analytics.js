// Self-analytics: response latency per model, tool success rates, active hours.
// Feeds the /analytics owner report.

class Analytics {
    constructor(state) {
        this.state = state;
        this.data = state.get("analytics", {
            modelLatency: {},   // model -> { totalMs, count }
            toolStats: {},      // tool -> { ok, fail }
            hours: {},          // "0"-"23" -> count (Asia/Kuala_Lumpur)
            days: {}            // date -> count
        });
    }

    _save() {
        this.state.set("analytics", this.data);
    }

    trackModelCall(model, latencyMs) {
        const e = this.data.modelLatency[model] || (this.data.modelLatency[model] = { totalMs: 0, count: 0 });
        e.totalMs += latencyMs;
        e.count++;
        this._save();
    }

    trackTool(tool, ok) {
        const e = this.data.toolStats[tool] || (this.data.toolStats[tool] = { ok: 0, fail: 0 });
        ok ? e.ok++ : e.fail++;
        this._save();
    }

    trackActivity() {
        const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
        const h = String(now.getHours());
        const d = now.toLocaleDateString("en-CA");
        this.data.hours[h] = (this.data.hours[h] || 0) + 1;
        this.data.days[d] = (this.data.days[d] || 0) + 1;
        // cap day history at 30 entries
        const keys = Object.keys(this.data.days);
        if (keys.length > 30) delete this.data.days[keys.sort()[0]];
        this._save();
    }

    report() {
        const lat = Object.entries(this.data.modelLatency)
            .map(([m, e]) => `  ${m}: ${(e.totalMs / e.count / 1000).toFixed(1)}s avg (${e.count}x)`)
            .join("\n") || "  -";
        const tools = Object.entries(this.data.toolStats)
            .map(([t, e]) => {
                const total = e.ok + e.fail;
                return `  ${t}: ${Math.round((e.ok / total) * 100)}% sukses (${total}x)`;
            })
            .join("\n") || "  -";
        const peak = Object.entries(this.data.hours).sort((a, b) => b[1] - a[1])[0];
        const last7 = Object.entries(this.data.days).sort().slice(-7)
            .map(([d, c]) => `  ${d.slice(5)}: ${"█".repeat(Math.min(c, 30))} ${c}`)
            .join("\n") || "  -";
        return (
            `📊 Alya analytics\n` +
            `Latency per model:\n${lat}\n` +
            `Tool success rate:\n${tools}\n` +
            `Jam paling aktif: ${peak ? peak[0] + ":00 (" + peak[1] + " pesan)" : "-"}\n` +
            `Aktivitas 7 hari:\n${last7}`
        );
    }
}

module.exports = { Analytics };
