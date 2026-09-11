// Group admin tools for the Telegram bridge — welcome message, anti-link,
// keyword auto-replies. Per-group settings persisted via StateStore.
// Admin/owner commands: /welcome, /antilink, /autoreply, /delreply

class GroupAdmin {
    constructor(state, tg) {
        this.state = state;
        this.tg = tg;
        this.groups = state.get("groupSettings", {});
    }

    _save() {
        this.state.set("groupSettings", this.groups);
    }

    get(chatId) {
        return this.groups[chatId] || (this.groups[chatId] = { welcome: null, antilink: false, autoreplies: {} });
    }

    setWelcome(chatId, text) {
        this.get(chatId).welcome = text || null;
        this._save();
    }

    setAntilink(chatId, on) {
        this.get(chatId).antilink = Boolean(on);
        this._save();
    }

    setAutoreply(chatId, keyword, response) {
        this.get(chatId).autoreplies[keyword.toLowerCase()] = response;
        this._save();
    }

    delAutoreply(chatId, keyword) {
        const replies = this.get(chatId).autoreplies;
        const existed = keyword.toLowerCase() in replies;
        delete replies[keyword.toLowerCase()];
        this._save();
        return existed;
    }

    // Returns true if the message was handled (deleted/answered), false to continue normal flow
    async onMessage(msg) {
        const chatId = msg.chat.id;
        const settings = this.get(chatId);
        const text = (msg.text || msg.caption || "").trim();

        // Welcome new members
        if (Array.isArray(msg.new_chat_members) && msg.new_chat_members.length && settings.welcome) {
            for (const member of msg.new_chat_members) {
                const name = member.first_name || "kawan baru";
                await this.tg.sendMessage(chatId, settings.welcome.replace(/\{name\}/g, name).replace(/\{user\}/g, name)).catch(() => {});
            }
            return true;
        }

        // Anti-link (skip admins/owner check — Telegram group admin check needs getChatMember; keep simple:
        // anyone posting a link when antilink is on gets the message deleted + a warning)
        if (settings.antilink && /(https?:\/\/|t\.me\/|wa\.me\/)/i.test(text)) {
            await this.tg.call("deleteMessage", { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
            await this.tg.sendMessage(chatId, `(｡•ˇ‸ˇ•｡) Maaf ya @${msg.from?.username || msg.from?.first_name}, link gak boleh di grup ini~`).catch(() => {});
            return true;
        }

        // Keyword auto-reply (exact word match)
        if (text) {
            const hit = settings.autoreplies[text.toLowerCase()];
            if (hit) {
                await this.tg.sendMessage(chatId, hit, { reply_to_message_id: msg.message_id }).catch(() => {});
                return true;
            }
        }
        return false;
    }
}

module.exports = { GroupAdmin };
