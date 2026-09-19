// chat-queue.js — per-chat concurrency control for WA bridge.
// Problem: 3 groups message simultaneously → 3 AI calls race →
// bubble sending interleaves across groups → looks broken.
//
// Solution: queue AI calls per-chat with a global concurrency limit.
// Each chat gets exclusive sending: AI reply + all bubbles finish
// before the next chat's handler starts.

class ChatQueue {
    constructor(maxConcurrent = 2) {
        this.maxConcurrent = maxConcurrent;
        this.running = 0;
        this.queue = [];  // [{ chatId, fn, resolve, reject }]
    }

    // Run fn() exclusively for this chatId. If maxConcurrent reached,
    // wait in queue. While running, no other task for same chatId runs.
    async run(chatId, fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ chatId, fn, resolve, reject });
            this._pump();
        });
    }

    _pump() {
        while (this.running < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift();
            this.running++;
            Promise.resolve()
                .then(() => task.fn())
                .then(
                    (result) => { this.running--; task.resolve(result); this._pump(); },
                    (error) => { this.running--; task.reject(error); this._pump(); }
                );
        }
    }

    get stats() {
        return { running: this.running, queued: this.queue.length, max: this.maxConcurrent };
    }
}

module.exports = { ChatQueue };
