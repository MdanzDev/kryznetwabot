// ptero.js command — Pterodactyl management from WhatsApp
// .ptero setkey <api_key>           — save your client API key (from panel: Account -> API Credentials)
// .ptero servers                    — list your servers
// .ptero start <id>                 — start server
// .ptero stop <id>                  — stop server
// .ptero restart <id>               — restart server
// .ptero status <id>                — server resource state
// .ptero logout                     — clear saved key
// .ptero users                      — admin: list all users
// .ptero nests                      — admin: list nests (egg categories)
// .ptero eggs <nest_id>             — admin: list eggs in a nest
// .ptero newserv <name> <email> <egg_id> <node_id>  — admin: create server for user
// .ptero delserv <id>               — admin: delete server
// .ptero nodes                      — admin: list nodes

const ptero = require("../../lib/ptero.js");
const fs = require("node:fs");
const path = require("node:path");

const SESSION_FILE = path.join(__dirname, "..", "..", "state", "ptero_sessions.json");

function loadSessions() {
    try { return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); } catch { return {}; }
}

function saveSessions(sessions) {
    try { fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2)); } catch {}
}

function getSession(userId) {
    const sessions = loadSessions();
    return sessions[userId] || null;
}

function setSession(userId, data) {
    const sessions = loadSessions();
    sessions[userId] = data;
    saveSessions(sessions);
}

function clearSession(userId) {
    const sessions = loadSessions();
    delete sessions[userId];
    saveSessions(sessions);
}

const fmt = (text) =>
    "╭───────────────୨୧\n" +
    "│  ₊˚⊹♡  " + text + "\n" +
    "╰───────────────୨୧";

module.exports = {
    name: "ptero",
    aliases: ["panel", "pterodactyl"],
    category: "owner",
    permissions: {
        coin: 0
    },
    code: async (ctx) => {
        const input = ctx.text || "";
        const [sub, ...args] = input.trim().split(/\s+/);
        const userId = ctx.getId(ctx.sender.jid);
        const isOwner = ctx.sender.isOwner();

        try {
            // ---- .ptero setkey <api_key> ----
            // Pterodactyl has no email+password login route on its API — each
            // user generates their own Client API key from the panel
            // (Account -> API Credentials -> Create) and pastes it here.
            if (sub === "setkey") {
                const key = args[0];
                if (!key) {
                    return await ctx.reply(fmt("Simpan API Key") +
                        `\n❖ ${ctx.format.inlineCode(ctx.used.prefix + "ptero setkey <api_key>")}\n\n` +
                        `Dapatkan key kau kat:\n${ptero.PANEL_URL}/account/api\n` +
                        `→ Create API Key (format: ptla_...)`);
                }
                if (!key.startsWith("ptla_")) {
                    return await ctx.reply(fmt("Key Tak Valid") +
                        "\n(｡•́︿•̀｡) Client API key kena start dengan `ptla_`. Buat dari panel: Account → API Credentials.");
                }
                await ctx.reply({ text: fmt("Sedang check key...") + "\n(｡･ω･｡)ﾉ Bentar ya~" });
                try {
                    const servers = await ptero.listClientServers(key);
                    setSession(userId, { clientKey: key });
                    return await ctx.reply(fmt("Key Disimpan!") +
                        `\n♡ Jumpa ${servers.length} server\n\nSekarang kau boleh guna:\n` +
                        `${ctx.format.inlineCode(ctx.used.prefix + "ptero servers")} — list server\n` +
                        `${ctx.format.inlineCode(ctx.used.prefix + "ptero start <id>")} — start\n` +
                        `${ctx.format.inlineCode(ctx.used.prefix + "ptero status <id>")} — status`);
                } catch (e) {
                    return await ctx.reply(fmt("Key Tak Valid") + `\n(╥﹏╥) ${e.message}`);
                }
            }

            // ---- .ptero logout ----
            if (sub === "logout") {
                clearSession(userId);
                return await ctx.reply(fmt("Logout Berhasil") + "\n(｡･ω･｡) Session dah dibuang~");
            }

            // ---- .ptero servers ----
            if (sub === "servers" || sub === "list") {
                const session = getSession(userId);
                if (!session) {
                    return await ctx.reply(fmt("Belum Setkey") +
                        `\n(｡•́︿•̀｡) Simpan key dulu: ${ctx.format.inlineCode(ctx.used.prefix + "ptero setkey <api_key>")}`);
                }
                const servers = await ptero.listClientServers(session.clientKey);
                if (!servers.length) {
                    return await ctx.reply(fmt("Tiada Server") + "\n(｡•́︿•̀｡) Kau takde server lagi.");
                }
                let text = fmt("Server Kau") + "\n";
                for (const s of servers) {
                    let state = "unknown";
                    try { state = (await ptero.getServerState(session.clientKey, s.identifier)).state; } catch {}
                    text += `\n┊ ❖ ${s.name}\n` +
                        `┊   ID: ${s.identifier}\n` +
                        `┊   RAM: ${s.limits?.memory || "?"}MB | CPU: ${s.limits?.cpu || "?"}%\n` +
                        `┊   State: ${state}\n`;
                }
                return await ctx.reply(text);
            }

            // ---- .ptero start|stop|restart|kill <id> ----
            if (["start", "stop", "restart", "kill"].includes(sub)) {
                const session = getSession(userId);
                if (!session) {
                    return await ctx.reply(fmt("Belum Setkey") +
                        `\n(｡•́︿•̀｡) Simpan key dulu: ${ctx.format.inlineCode(ctx.used.prefix + "ptero setkey <api_key>")}`);
                }
                const serverId = args[0];
                if (!serverId) {
                    return await ctx.reply(fmt("Server ID Diperlukan") +
                        `\n❖ ${ctx.format.inlineCode(ctx.used.prefix + "ptero " + sub + " <server_id>")}`);
                }
                try {
                    await ptero.powerAction(session.clientKey, serverId, sub);
                    const emoji = { start: "🟢", stop: "🔴", restart: "🔄", kill: "💀" }[sub];
                    return await ctx.reply(fmt(`${emoji} ${sub.toUpperCase()}`) +
                        `\nServer ${serverId} → ${sub}`);
                } catch (e) {
                    return await ctx.reply(fmt("Gagal") + `\n(╥﹏╥) ${e.message}`);
                }
            }

            // ---- .ptero status <id> ----
            if (sub === "status") {
                const session = getSession(userId);
                if (!session) {
                    return await ctx.reply(fmt("Belum Setkey") +
                        `\n(｡•́︿•̀｡) Simpan key dulu: ${ctx.format.inlineCode(ctx.used.prefix + "ptero setkey <api_key>")}`);
                }
                const serverId = args[0];
                if (!serverId) {
                    return await ctx.reply(fmt("Server ID Diperlukan") +
                        `\n❖ ${ctx.format.inlineCode(ctx.used.prefix + "ptero status <server_id>")}`);
                }
                try {
                    const state = await ptero.getServerState(session.clientKey, serverId);
                    return await ctx.reply(fmt("Server Status") +
                        `\n┊ Server: ${serverId}\n` +
                        `┊ State: ${state.state}\n` +
                        `┊ CPU: ${state.cpu || 0}%\n` +
                        `┊ RAM: ${state.ram || 0}MB\n` +
                        `┊ Disk: ${state.disk || 0}MB`);
                } catch (e) {
                    return await ctx.reply(fmt("Gagal") + `\n(╥﹏╥) ${e.message}`);
                }
            }

            // ---- ADMIN COMMANDS (owner only) ----
            // ---- .ptero users ----
            if (sub === "users") {
                if (!isOwner) return await ctx.reply(fmt("Owner Only") + "\n(｡•ˇ‸ˇ•｡) Admin je boleh.");
                const users = await ptero.listUsers();
                let text = fmt("All Users") + `\nTotal: ${users.length} user\n`;
                for (const u of users) {
                    text += `\n┊ ❖ ${u.name} ${u.admin ? "👑" : ""}\n` +
                        `┊   ${u.email} (id: ${u.id})\n`;
                }
                return await ctx.reply(text);
            }

            // ---- .ptero nests ----
            if (sub === "nests") {
                if (!isOwner) return await ctx.reply(fmt("Owner Only") + "\n(｡•ˇ‸ˇ•｡) Admin je boleh.");
                const nests = await ptero.listNests();
                let text = fmt("Nests") + `\nTotal: ${nests.length}\n`;
                for (const n of nests) {
                    text += `\n┊ ❖ ${n.name} (id: ${n.id})\n`;
                }
                text += `\nGuna ${ctx.format.inlineCode(ctx.used.prefix + "ptero eggs <nest_id>")} untuk tengok eggs.`;
                return await ctx.reply(text);
            }

            // ---- .ptero eggs <nest_id> ----
            if (sub === "eggs") {
                if (!isOwner) return await ctx.reply(fmt("Owner Only") + "\n(｡•ˇ‸ˇ•｡) Admin je boleh.");
                const nestId = args[0];
                if (!nestId) {
                    return await ctx.reply(fmt("Nest ID Diperlukan") +
                        `\n❖ ${ctx.format.inlineCode(ctx.used.prefix + "ptero eggs <nest_id>")}\n` +
                        `Tengok nest_id dengan ${ctx.format.inlineCode(ctx.used.prefix + "ptero nests")}`);
                }
                try {
                    const eggs = await ptero.listEggs(nestId);
                    let text = fmt("Eggs") + `\nTotal: ${eggs.length}\n`;
                    for (const e of eggs) {
                        text += `\n┊ ❖ ${e.name} (id: ${e.id})\n`;
                    }
                    return await ctx.reply(text);
                } catch (e) {
                    return await ctx.reply(fmt("Gagal") + `\n(╥﹏╥) ${e.message}`);
                }
            }

            // ---- .ptero newserv <name> <email> <egg_id> <node_id> ----
            if (sub === "newserv") {
                if (!isOwner) return await ctx.reply(fmt("Owner Only") + "\n(｡•ˇ‸ˇ•｡) Admin je boleh.");
                const [name, email, eggId, nodeId] = args;
                if (!name || !email || !eggId || !nodeId) {
                    return await ctx.reply(fmt("Create Server") +
                        `\n❖ ${ctx.format.inlineCode(ctx.used.prefix + "ptero newserv <name> <email> <egg_id> <node_id>")}\n\n` +
                        `Cari egg_id: ${ctx.format.inlineCode(ctx.used.prefix + "ptero nests")} lepas ${ctx.format.inlineCode(ctx.used.prefix + "ptero eggs <nest_id>")}\n` +
                        `Cari node_id: ${ctx.format.inlineCode(ctx.used.prefix + "ptero nodes")}`);
                }
                const user = await ptero.getUserByEmail(email);
                if (!user) return await ctx.reply(fmt("User Tak Jumpa") + `\n(｡•́︿•̀｡) Email ${email} takda kat panel.`);
                try {
                    const srv = await ptero.createServer(name, user.id, eggId, nodeId);
                    return await ctx.reply(fmt("Server Dibuat!") +
                        `\n♡ Name: ${srv.name}\n♡ ID: ${srv.id}\n♡ UUID: ${srv.uuid}`);
                } catch (e) {
                    return await ctx.reply(fmt("Gagal Buat Server") + `\n(╥﹏╥) ${e.message}`);
                }
            }

            // ---- .ptero delserv <id> ----
            if (sub === "delserv") {
                if (!isOwner) return await ctx.reply(fmt("Owner Only") + "\n(｡•ˇ‸ˇ•｡) Admin je boleh.");
                const serverId = args[0];
                if (!serverId) {
                    return await ctx.reply(fmt("Delete Server") +
                        `\n❖ ${ctx.format.inlineCode(ctx.used.prefix + "ptero delserv <server_id>")}`);
                }
                try {
                    await ptero.deleteServer(serverId, true);
                    return await ctx.reply(fmt("Server Dipadam") + `\n(｡･ω･｡) Server ${serverId} dah hapus~`);
                } catch (e) {
                    return await ctx.reply(fmt("Gagal Padam") + `\n(╥﹏╥) ${e.message}`);
                }
            }

            // ---- .ptero nodes ----
            if (sub === "nodes") {
                if (!isOwner) return await ctx.reply(fmt("Owner Only") + "\n(｡•ˇ‸ˇ•｡) Admin je boleh.");
                const nodes = await ptero.listNodes();
                let text = fmt("Nodes") + `\nTotal: ${nodes.length} node\n`;
                for (const n of nodes) {
                    text += `\n┊ ❖ ${n.name} (id: ${n.id})\n` +
                        `┊   ${n.fqdn}:${n.daemon_listen}\n` +
                        `┊   RAM: ${n.memory}MB | Disk: ${n.disk}MB\n`;
                }
                return await ctx.reply(text);
            }

            // ---- .ptero (no sub) → help ----
            return await ctx.reply(fmt("Pterodactyl Panel") +
                `\n${ctx.format.bold("User Commands:")}\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero setkey <api_key>")} — simpan key\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero servers")} — list server kau\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero start <id>")} — start server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero stop <id>")} — stop server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero restart <id>")} — restart\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero status <id>")} — status server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero logout")} — logout\n` +
                (isOwner ? `\n${ctx.format.bold("Admin Commands:")}\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero users")} — list semua user\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero nests")} — list nests\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero eggs <nest_id>")} — list eggs\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero newserv <name> <email> <egg_id> <node_id>")} — buat server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero delserv <id>")} — padam server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero nodes")} — list nodes\n` : "") +
                `\nPanel: ${ptero.PANEL_URL}`);
        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
};
