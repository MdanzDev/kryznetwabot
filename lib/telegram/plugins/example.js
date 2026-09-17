// example.js — contoh plugin Alya.
// Struktur plugin: export { name, init(bot), onMessage?(msg, prompt, bot), destroy?() }
// init(bot) dipanggil saat plugin load. onMessage return true kalau pesan di-handle.
// Letakkan file ini di lib/telegram/plugins/<nama>.js

module.exports = {
    name: "example",

    init(bot) {
        console.log("[plugin:example] loaded! Bot punya:", Object.keys(bot).slice(0, 5).join(", "));
        // Simpan state kalau perlu:
        // this.counter = 0;
    },

    // Dipanggil untuk SETIAP pesan masuk. Return true kalau plugin handle pesan ini.
    onMessage(msg, prompt, bot) {
        const text = (prompt || "").toLowerCase().trim();

        // Contoh: plugin ping
        if (text === "ping") {
            bot.tg.sendMessage(msg.chat.id, "pong! (dari plugin contoh)");
            return true; // handled — jangan proses lagi
        }

        // Contoh: plugin jam
        if (text === "jam berapa") {
            const now = new Date().toLocaleString("id-ID", { timeZone: "Asia/Kuala_Lumpur" });
            bot.tg.sendMessage(msg.chat.id, `sekarang jam ${now} (KL)`);
            return true;
        }

        return false; // tidak di-handle — biarkan AI/chat flow sambung
    },

    destroy() {
        console.log("[plugin:example] unloaded");
    }
};
