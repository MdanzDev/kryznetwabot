// Reminder scheduler — chat-managed cron. "ingatkan aku 2 jam lagi cek server"
// or "setiap hari jam 9 kirim status pm2". Owner-only for recurring/system jobs.

class Scheduler {
    constructor(state, sender) {
        this.state = state;         // StateStore
        this.sender = sender;       // async (chatId, text) => {}  (default channel)
        this.channels = {};         // platform -> async (chatId, text)
        this.jobs = this.state.get("reminders", []);
        this.timer = null;
    }

    // A reminder created on WhatsApp must be delivered on WhatsApp, and one
    // created on Telegram on Telegram. Registering the transport per platform
    // keeps jobs portable: the job stores only its platform name.
    addChannel(platform, sendFn) {
        if (typeof sendFn !== "function") throw new TypeError("addChannel needs a send function");
        this.channels[platform] = sendFn;
    }

    _sendFor(job) {
        if (job.platform && this.channels[job.platform]) return this.channels[job.platform];
        return this.sender;
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => this.tick(), 30000);
        this.timer.unref?.();
        console.log(`[TG-cron] scheduler started, ${this.jobs.length} job(s) loaded`);
    }

    add(job) {
        // job: { id, chatId, text, at (epoch ms) | cron: {hour, minute, tzOffsetMin}, once: bool }
        this.jobs.push(job);
        this.state.set("reminders", this.jobs);
        return job.id;
    }

    list(chatId) {
        return this.jobs.filter((j) => j.chatId === chatId);
    }

    remove(id, chatId) {
        const before = this.jobs.length;
        this.jobs = this.jobs.filter((j) => !(j.id === id && j.chatId === chatId));
        this.state.set("reminders", this.jobs);
        return this.jobs.length < before;
    }

    async tick() {
        const now = Date.now();
        const nowDate = new Date();
        const fired = [];
        for (const job of this.jobs) {
            if (job.at && now >= job.at) {
                fired.push(job);
                job._done = true;
            } else if (job.cron) {
                const local = new Date(nowDate.getTime() + (job.cron.tzOffsetMin || 480) * 60000);
                const key = `${local.getUTCFullYear()}-${local.getUTCMonth()}-${local.getUTCDate()}-${local.getUTCHours()}-${local.getUTCMinutes()}`;
                const hourMatch = local.getUTCHours() === job.cron.hour;
                const minMatch = local.getUTCMinutes() === job.cron.minute;
                // Optional job.cron.days = [1..7] Mon..Sun. Omitted = every day.
                const dayMatch = !Array.isArray(job.cron.days)
                    || job.cron.days.includes(local.getUTCDay() === 0 ? 7 : local.getUTCDay());
                if (hourMatch && minMatch && dayMatch && job._lastFire !== key) {
                    job._lastFire = key;
                    fired.push(job);
                }
            }
        }
        for (const job of fired) {
            await this._sendFor(job)(job.chatId, job.text)
                .catch((e) => console.error(`[cron] send ${job.platform || "default"}:`, e.message));
        }
        const before = this.jobs.length;
        this.jobs = this.jobs.filter((j) => !j._done);
        if (this.jobs.length !== before || fired.length) this.state.set("reminders", this.jobs);
    }
}

module.exports = { Scheduler };
