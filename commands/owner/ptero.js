// ptero.js command — Pterodactyl management from WhatsApp
// .ptero login <email> <password>  — login, saves client API key
// .ptero servers                    — list your servers
// .ptero start <id>                 — start server
// .ptero stop <id>                  — stop server
// .ptero restart <id>               — restart server
// .ptero status <id>                — server resource state
// .ptero users                      — admin: list all users
// .ptero newserv <name> <email>     — admin: create server for user
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
        // FIX: ctx.flag.input was empty/undefined — subcommand parsing must
        // come from ctx.text, same as group.js does.
        const input = ctx.text || "";
        const [sub, ...args] = input.trim().split(/\s+/);
        console.log("[ptero] fired! input:", JSON.stringify(input), "sub:", sub);
        const userId = ctx.getId(ctx.sender.jid);
        const isOwner = ctx.sender.isOwner();

        try {
            // ---- .ptero login <email> <password> ----
            if (sub === "login") {
                const email = args[0];
                const password = args[1];
                if (!email || !password) {
                    return await ctx.reply(fmt("Login Pterodactyl") +
                        `\n❖ ${ctx.format.inlineCode(ctx.used.prefix + "ptero login <email> <password>")}`);
                }
                await ctx.reply({ text: fmt("Sedang login...") + "\n(｡･ω･｡)ﾉ Bentar ya~" });
                try {
                    // Get JWT via login
                    const jwt = await ptero.login(email, password);
                    // Create a client API key for persistent access
                    const keyInfo = await ptero.createClientApiKey(jwt, `WA Bot ${userId}`);
                    if (!keyInfo.token) throw new Error("Failed to create API key");
                    setSession(userId, { clientKey: keyInfo.token, identifier: keyInfo.identifier, email });
                    return await ctx.reply(fmt("Login Berhasil!") +
                        `\n♡ Email: ${email}\n♡ Key: ${keyInfo.identifier}\n\nSekarang kau boleh guna:\n` +
                        `${ctx.format.inlineCode(ctx.used.prefix + "ptero servers")} — list server\n` +
                        `${ctx.format.inlineCode(ctx.used.prefix + "ptero start <id>")} — start\n` +
                        `${ctx.format.inlineCode(ctx.used.prefix + "ptero status <id>")} — status`);
                } catch (e) {
                    return await ctx.reply(fmt("Login Gagal") + `\n(╥﹏╥) ${e.message}`);
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
                    return await ctx.reply(fmt("Belum Login") +
                        `\n(｡•́︿•̀｡) Login dulu: ${ctx.format.inlineCode(ctx.used.prefix + "ptero login <email> <password>")}`);
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
                    return await ctx.reply(fmt("Belum Login") +
                        `\n(｡•́︿•̀｡) Login dulu: ${ctx.format.inlineCode(ctx.used.prefix + "ptero login <email> <password>")}`);
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
                    return await ctx.reply(fmt("Belum Login") +
                        `\n(｡•́︿•̀｡) Login dulu: ${ctx.format.inlineCode(ctx.used.prefix + "ptero login <email> <password>")}`);
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

            // ---- .ptero newserv <name> <email> ----
            if (sub === "newserv") {
                if (!isOwner) return await ctx.reply(fmt("Owner Only") + "\n(｡•ˇ‸ˇ•｡) Admin je boleh.");
                const name = args[0];
                const email = args[1];
                if (!name || !email) {
                    return await ctx.reply(fmt("Create Server") +
                        `\n❖ ${ctx.format.inlineCode(ctx.used.prefix + "ptero newserv <name> <email>")}`);
                }
                const user = await ptero.getUserByEmail(email);
                if (!user) return await ctx.reply(fmt("User Tak Jumpa") + `\n(｡•́︿•̀｡) Email ${email} takda kat panel.`);
                try {
                    const srv = await ptero.createServer(name, user.id);
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
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero login <email> <password>")} — login\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero servers")} — list server kau\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero start <id>")} — start server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero stop <id>")} — stop server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero restart <id>")} — restart\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero status <id>")} — status server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero logout")} — logout\n` +
                (isOwner ? `\n${ctx.format.bold("Admin Commands:")}\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero users")} — list semua user\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero newserv <name> <email>")} — buat server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero delserv <id>")} — padam server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero nodes")} — list nodes\n` : "") +
                `\nPanel: ${ptero.PANEL_URL}`);
        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
};
essage}`);
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
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero login <email> <password>")} — login\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero servers")} — list server kau\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero start <id>")} — start server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero stop <id>")} — stop server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero restart <id>")} — restart\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero status <id>")} — status server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero logout")} — logout\n` +
                (isOwner ? `\n${ctx.format.bold("Admin Commands:")}\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero users")} — list semua user\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero newserv <name> <email>")} — buat server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero delserv <id>")} — padam server\n` +
                `${ctx.format.inlineCode(ctx.used.prefix + "ptero nodes")} — list nodes\n` : "") +
                `\nPanel: ${ptero.PANEL_URL}`);
        } catch (error) {
            await ctx.helper.handleError(ctx, error, true);
        }
    }
};
