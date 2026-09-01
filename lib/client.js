const Baileys = require("baileys");
const {
    downloadMediaMessage,
    normalizeMessageContent,
    getContentType
} = Baileys;
const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");
const { NodeCache } = require("@cacheable/node-cache");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const SimplDB = require("simpl.db");
const vCard = require("vcard-parser");
const WASF = require("wa-sticker-formatter");
const api = require("./api");
const Ctx = require("./ctx");
const format = require("./format");
const { Commands } = require("./handler");
const helper = require("./helper");
const list = require("./list");

class Client {
    constructor(opts = {}) {
        this.authDir = opts.auth?.dir || "./auth";
        this.phoneNumber = opts.auth?.phoneNumber || null;
        this.usePairingCode = opts.auth?.usePairingCode || false;
        this.customPairingCode = opts.auth?.customPairingCode || null;
        this.useStore = opts.auth?.useStore || false;

        this.browser = opts.connection?.browser || Baileys.Browsers.macOS("Safari");
        this.WAVersion = opts.connection?.version || null;
        this.alwaysOnline = opts.connection?.alwaysOnline || false;
        this.selfReply = opts.connection?.selfReply || false;
        this.loggerLevel = opts.connection?.loggerLevel || "silent";

        this.autoRead = opts.messaging?.autoRead || false;
        this.prefix = opts.messaging?.prefix || /^[°•π÷×¶∆£¢€¥®™+✓_=|/~!?@#%^&.©^]/i;
        if (Array.isArray(this.prefix)) this.prefix = this.prefix.sort((a, b) => (a === "" ? 1 : b === "" ? -1 : 0));

        this.databaseDir = opts.database?.dir || "./database";
        this.databaseDefaults = opts.database?.defaults || {};

        this.owner = opts.owner || [];

        this.ev = new EventEmitter();
        this.cmd = new Map();
        this.cooldown = new Map();
        this.hearsMap = new Map();
        this.middlewares = [];
        this.logger = pino({
            level: this.loggerLevel
        });
        this.store = null;
        this.storePath = path.resolve(this.authDir, "store.json");
        this.groupCache = new NodeCache({
            stdTTL: 24 * 60 * 60,
            useClones: false
        });
        this.messageIdCache = new NodeCache({
            stdTTL: 24 * 60 * 60,
            useClones: false
        });

        this.statusCache = new Map();

        this.db = new SimplDB({
            collectionsFolder: this.databaseDir,
            tabSize: 2
        });
        ["bot", "users", "groups"].forEach(name => {
            if (!this.db.getCollection(name)) this.db.createCollection(name, this.databaseDefaults[name] || {});
        });
    }

    async _cacheStatusMessage(message) {
        if (!message?.key) return;

        const remoteJid = message.key.remoteJid;

        if (remoteJid !== "status@broadcast") return;

        const participant =
            message.key.participant ||
            message.key.participantAlt;

        if (!participant) return;

        const jid = Baileys.jidNormalizedUser(participant);

        if (!this.statusCache.has(jid)) {
            this.statusCache.set(jid, []);
        }

        const statuses = this.statusCache.get(jid);

        // Prevent duplicates
        if (statuses.some(status => status.key?.id === message.key?.id)) {
            return;
        }

        statuses.push(message);

        // WhatsApp statuses normally expire after 24 hours.
        const cutoff = Date.now() - (24 * 60 * 60 * 1000);

        const validStatuses = statuses.filter(status => {
            const timestamp = Number(status.messageTimestamp || 0) * 1000;

            return timestamp === 0 || timestamp >= cutoff;
        });

        this.statusCache.set(jid, validStatuses);
    }

async _resolveJidAndLid(candidateJid) {
    if (!candidateJid) return { jid: undefined, lid: undefined };

    const normalized = Baileys.jidNormalizedUser(candidateJid);

    let jid = Baileys.isPnUser(normalized) || Baileys.isHostedPnUser(normalized)
        ? normalized
        : undefined;

    let lid = Baileys.isLidUser(normalized) || Baileys.isHostedLidUser(normalized)
        ? normalized
        : undefined;

    if (jid && lid) return { jid, lid };

    try {
        const result = await this.core.findUserId(normalized);
        jid = jid || (result?.phoneNumber ? Baileys.jidNormalizedUser(result.phoneNumber) : undefined);
        lid = lid || (result?.lid ? Baileys.jidNormalizedUser(result.lid) : undefined);
    } catch (error) {
        this.logger.warn({
            candidateJid: normalized,
            error: error?.message
        }, "Unable to resolve PN/LID pair for status cache");
    }

    return { jid, lid };
}

    async _syncStatusUpdates(keys, timeoutMs = 2500) {
    await Promise.all(keys.map(async (key) => {
        try {
            await this.core.presenceSubscribe(key);
        } catch (error) {
            this.logger.debug({
                key,
                error: error?.message
            }, "presenceSubscribe failed for status sync");
        }
    }));

    // Give WhatsApp's server time to push the status
    // messages back to us via messages.upsert before we
    // read from the cache.
    await Baileys.delay(timeoutMs);
}

async fetchStatusUpdates(jid, opts = {}) {
    if (!jid) {
        throw new Error("JID is required");
    }

    const { forceSync = true, syncTimeoutMs = 2500 } = opts;

    const { jid: pn, lid } = await this._resolveJidAndLid(jid);

    const keys = [pn, lid, Baileys.jidNormalizedUser(jid)]
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i);

    if (forceSync) {
        await this._syncStatusUpdates(keys, syncTimeoutMs);
    }

    const cutoff = Date.now() - (24 * 60 * 60 * 1000);
    const merged = new Map();

    for (const key of keys) {
        const statuses = this.statusCache.get(key) || [];

        const valid = statuses.filter(status => {
            const timestamp = Number(status.messageTimestamp || 0) * 1000;
            return timestamp === 0 || timestamp >= cutoff;
        });

        this.statusCache.set(key, valid);

        for (const status of valid) {
            merged.set(status.key?.id, status);
        }
    }

    return Array.from(merged.values());
}



    async downloadStatus(message) {
        if (!message?.message) {
            throw new Error("Invalid status message");
        }

        const normalized =
            Baileys.normalizeMessageContent(message.message);

        if (!normalized) {
            throw new Error("Unable to normalize status message");
        }

       let contentType = Baileys.getContentType(normalized);

// Handle view-once wrappers
if (contentType === "viewOnceMessage") {
    const inner = normalized.viewOnceMessage?.message;
    if (!inner) throw new Error("Invalid view-once status");
    contentType = Baileys.getContentType(inner);   // <-- contentType is now "imageMessage"/"videoMessage"
}

let mediaMessage = normalized;

if (contentType === "viewOnceMessage") {            // <-- this is now ALWAYS false, since contentType was already overwritten above
    mediaMessage = normalized.viewOnceMessage.message;
}

        if (
            contentType !== "imageMessage" &&
            contentType !== "videoMessage"
        ) {
            return null;
        }

        const downloadMessage = {
            ...message,
            message: mediaMessage
        };

        const buffer = await Baileys.downloadMediaMessage(
            downloadMessage,
            "buffer",
            {},
            {
                logger: this.logger,
                reuploadRequest: async msg => {
                    return this.core.updateMediaMessage(msg);
                }
            }
        );

        return {
            type:
                contentType === "imageMessage"
                    ? "image"
                    : "video",

            buffer,

            message: mediaMessage
        };
    }

    clearStatusCache(jid) {
        if (!jid) {
            this.statusCache.clear();
            return;
        }

        this.statusCache.delete(
            Baileys.jidNormalizedUser(jid)
        );
    }

    _shouldIgnore(message) {
        if (message.message?.protocolMessage) return true;
        if (message.key.fromMe && /^3EB0[0-9A-F]{9,16}$/i.test(message.key.id)) return true;
        if (this.messageIdCache.get(message.key.id)) return true;
        this.messageIdCache.set(message.key.id, true);
        return false;
    }

   async _getSender(key) {
    const fromMe = key.fromMe;
    const user = this.core?.user;

    if (fromMe) {
        const jid = user?.id
            ? Baileys.jidNormalizedUser(user.id)
            : undefined;

        const lid = user?.lid
            ? Baileys.jidNormalizedUser(user.lid)
            : undefined;

        return { jid, lid };
    }

    const candidates = [
        key.participant,
        key.participantAlt,
        key.remoteJid,
        key.remoteJidAlt
    ]
        .filter(Boolean)
        .map(jid => Baileys.jidNormalizedUser(jid));

    // Only accept actual PN/LID user JIDs.
    let jid = candidates.find(id =>
        Baileys.isPnUser(id) || Baileys.isHostedPnUser(id)
    );

    let lid = candidates.find(id =>
        Baileys.isLidUser(id) || Baileys.isHostedLidUser(id)
    );

    // If we already have both, we're done.
    if (jid && lid) {
        return { jid, lid };
    }

    // Only call findUserId() with a JID type that Baileys accepts.
    const lookupJid = jid || lid;

    if (!lookupJid) {
        return {
            jid: undefined,
            lid: undefined
        };
    }

    try {
        const result = await this.core.findUserId(lookupJid);

        jid = jid || result?.phoneNumber;
        lid = lid || result?.lid;
    } catch (error) {
        // Don't let one malformed/unresolvable message kill the bot.
        this.logger.warn({
            lookupJid,
            error: error?.message
        }, "Unable to resolve message sender");

        return {
            jid,
            lid
        };
    }

    return {
        jid: jid ? Baileys.jidNormalizedUser(jid) : undefined,
        lid: lid ? Baileys.jidNormalizedUser(lid) : undefined
    };
}

    _updatePushName(jid, pushName) {
        const userDb = helper.getDb(this.db.getCollection("users"), jid);
        if (userDb && userDb.pushName !== pushName) {
            userDb.pushName = pushName;
            userDb.save();
        }
    }

    async _cacheGroupMetadata(id) {
        try {
            const metadata = await this.core?.groupMetadata(id);
            if (metadata) this.groupCache.set(id, metadata);
            return metadata;
        } catch {
            return null;
        }
    }

    async _cacheAllGroups() {
        const groups = await this.core.groupFetchAllParticipating();
        for (const [id, metadata] of Object.entries(groups)) this.groupCache.set(id, metadata);
    }

    _setupEvent() {
        this.core.ev.on("connection.update", async (update) => {
            const {
                connection,
                lastDisconnect,
                qr
            } = update;
            if (qr) {
                console.log(util.styleText("cyan", "[i]"), "Scan the QR code below:");
                qrcode.generate(qr, {
                    small: true
                });
            }
            if (connection === "close") {
                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== Baileys.DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.warn(util.styleText("yellow", "[!]"), "Reconnecting...");
                    await this.launch();
                }
            } else if (connection === "open") {
                if (!this.readyAt) this.readyAt = Date.now();
                this.ev.emit("ClientReady", this.core);
                await Baileys.delay(3000);
                await this._cacheAllGroups();
            }
        });

        this.core.ev.on("creds.update", this.saveCreds);

        this.core.ev.on("messages.upsert", async (event) => {
    for (const message of event.messages) {
        if (message.key?.remoteJid === "status@broadcast") {
            this.logger.info({
                participant: message.key.participant,
                participantAlt: message.key.participantAlt,
                id: message.key.id,
                ts: message.messageTimestamp
            }, "[debug] status@broadcast received");
        }

        await this._cacheStatusMessage(message);

                // Status messages aren't normal chat messages.
                if (message.key?.remoteJid === "status@broadcast") {
                    continue;
                }

                if (event.type !== "notify") continue;

                const sender = await this._getSender(message.key);

                if (!sender.jid && !sender.lid) {
                    this.logger.debug({
                        key: message.key
                    }, "Skipping message with unresolved sender");

                    continue;
                }

                if (sender.lid && message.pushName) {
                    this._updatePushName(sender.lid, message.pushName);
                }
                const body = helper.getBodyFromMsg(message);
                const ctx = new Ctx({
                    used: {
                        upsert: body
                    },
                    args: [],
                    self: {
                        ...this,
                        sender: {
                            ...sender,
                            pushName: message.pushName
                        },
                        m: {
                            ...message,
                            body
                        }
                    },
                    client: this.core
                });
                this.ev.emit("MessagesUpsert", ctx);
                if (this.autoRead) {
                    const mode = helper.getDb(this.db.getCollection("bot")).mode;
                    const jid = message.key.remoteJid;
                    const shouldRead = mode === "public" || (mode === "group" && Baileys.isJidGroup(jid)) || (mode === "private" && (Baileys.isLidUser(jid) || Baileys.isPnUser(jid)));
                    if (shouldRead) await this.core.readMessages([message.key]);
                }
                await Commands({
                    ...this,
                    m: {
                        ...message,
                        body
                    },
                    sender: {
                        ...sender,
                        pushName: message.pushName
                    }
                }, this._runMiddlewares.bind(this));
            }
        });

        this.core.ev.on("group-participants.update", async (event) => {
            await this._cacheGroupMetadata(event.id);
            const {
                action,
                participants,
                ...rest
            } = event;
            if (!["add", "leave", "remove"].includes(action)) return;
            const eventName = action === "add" ? "UserJoin" : "UserLeave";
            for (const participant of participants) {
                this.ev.emit(eventName, {
                    ...rest,
                    participant: participant.id,
                    participantPn: participant.phoneNumber
                });
            }
        });

        this.core.ev.on("groups.update", async ([event]) => this._cacheGroupMetadata(event.id));
        this.core.ev.on("groups.upsert", async ([event]) => this._cacheGroupMetadata(event.id));
        this.core.ev.on("call", (calls) => calls.forEach(call => this.ev.emit("Call", call)));

        ["passkey_prologue_request", "crsc_continuation"].forEach(type => {
            this.core.ws.on(`CB:notification,type:${type}`, async (node) => {
                await this.core.sendNode({
                    tag: "ack",
                    attrs: {
                        id: node.attrs.id,
                        class: "notification",
                        to: node.attrs.from,
                        type: node.attrs.type
                    }
                });
            });
        });
    }

    use(fn) {
        this.middlewares.push(fn);
    }

    async _runMiddlewares(ctx, index = 0) {
        if (index >= this.middlewares.length) return true;
        let shouldContinue = false;
        let nextCalled = false;
        await this.middlewares[index](ctx, async () => {
            if (nextCalled) throw new Error("next() called multiple times in middleware");
            nextCalled = true;
            shouldContinue = await this._runMiddlewares(ctx, index + 1);
        });
        return nextCalled && shouldContinue;
    }

    command(opts, code) {
        const command = typeof opts === "string" ? {
            name: opts,
            code
        } : opts;
        this.cmd.set(command.name, command);
    }

    hears(query, callback) {
        this.hearsMap.set(query, {
            name: query,
            code: callback
        });
    }

    get api() {
        return api;
    }
    get format() {
        return format;
    }
    get helper() {
        return helper;
    }
    get list() {
        return list;
    }

    checkOwner(jid = Baileys.PSA_WID, fromMe = false) {
        return helper.checkOwner(jid, this.owner, fromMe);
    }
    getPushName(jid = Baileys.PSA_WID) {
        return helper.getPushName(jid, this.db);
    }
    getId(jid = Baileys.PSA_WID) {
        return helper.getId(jid);
    }
    getDb(collection, jid = Baileys.PSA_WID) {
        const coll = this.db.getCollection(collection);
        return helper.getDb(coll, jid);
    }

    async forceCommand(jid, command, text = "", sender) {
        const body = text ? `${command} ${text}` : command;
        const fakeMsg = {
            key: {
                remoteJid: jid,
                fromMe: Baileys.areJidsSameUser(sender.jid, this.core?.user?.id),
                id: Baileys.generateMessageIDV2(),
                ...(jid !== sender.jid && {
                    participant: sender.jid,
                    ...(sender.lid && {
                        participantAlt: sender.lid
                    })
                })
            },
            message: {
                conversation: body
            },
            body,
            pushName: sender.pushName
        };
        await Commands({
            ...this,
            m: fakeMsg,
            sender,
            force: true
        }, this._runMiddlewares.bind(this));
    }

    async launch() {
        const {
            state,
            saveCreds
        } = await Baileys.useMultiFileAuthState(this.authDir);
        this.state = state;
        this.saveCreds = saveCreds;

        this.core = Baileys.default({
            auth: this.state,
            logger: this.logger,
            ...(this.WAVersion && {
                version: this.WAVersion
            }),
            browser: this.browser,
            markOnlineOnConnect: this.alwaysOnline,
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => false,
            ...(this.useStore && {
                getMessage: async (key) => (await this.store.loadMessage(key.remoteJid, key.id))?.message
            }),
            emitOwnEvents: this.selfReply,
            cachedGroupMetadata: async (jid) => this.groupCache.get(jid),
            generateHighQualityLinkPreview: true

        });

        this.core.fetchStatusUpdates =
            this.fetchStatusUpdates.bind(this);

        this.core.downloadStatus =
            this.downloadStatus.bind(this);

        this.core.clearStatusCache =
            this.clearStatusCache.bind(this);

        if (this.usePairingCode && !this.core.authState.creds.registered) {
            if (!this.phoneNumber) throw new Error("phoneNumber required for pairing code");
            this.phoneNumber = this.phoneNumber.replace(/[^0-9]/g, "");
            if (!this.phoneNumber.length) throw new Error("Invalid phoneNumber");
            await Baileys.delay(3000);
            const code = await this.core.requestPairingCode(this.phoneNumber, this.customPairingCode);
            console.log(util.styleText("cyan", "[i]"), `Pairing Code: ${code}`);
        }

        if (!fs.existsSync(this.databaseDir))
            fs.mkdirSync(this.databaseDir, {
                recursive: true
            });

        this._setupStore();
        this._setupEvent();

        this.sendMessage = this._createSendMessage.bind(this);
        return this;
    }

    _setupStore() {
        if (!this.useStore) return;
        this.store = Baileys.makeInMemoryStore({
            logger: this.logger,
            socket: this.core
        });
        this.store.bind(this.core.ev);
        if (fs.existsSync(this.storePath)) this.store.readFromFile(this.storePath);
        setInterval(() => this.store.writeToFile(this.storePath), 10000);
        this.store.cleanupMessages = (cutoff) => {
            for (const jid of Object.keys(this.store.messages)) this.store.messages[jid] = this.store.messages[jid].filter(msg => msg.messageTimestamp * 1000 > cutoff);
        };
        setInterval(() => this.store.cleanupMessages(Date.now() - (7 * 24 * 60 * 60 * 1000)), 24 * 60 * 60 * 1000);
    }

    async _createSendMessage(jid, content, options = {}) {
        if (typeof content === "string")
            content = {
                text: content
            };
        content = await this._processAlbum(content);
        content = await this._processSticker(content, options);
        content = await this._processContacts(content);
        content = await this._processStickerPack(content, options);
        if (Baileys.isPnUser(jid) || Baileys.isLidUser(jid)) content.ai = true;
        return await this.core.sendMessage(jid, content, options);
    }

    async _processAlbum(content) {
        if (!content?.album || content.album.length === 0) return content;
        if (content.album.length === 1) {
            const {
                album,
                ...rest
            } = content;
            return {
                ...rest,
                ...album[0]
            };
        }
        if (content.album.every(a => !a.caption) && content.caption) content.album[0].caption = content.caption;
        return {
            album: content.album
        };
    }

    async _processSticker(content, options) {
        if (!content?.sticker) return content;
        const stickerData = content.sticker;
        const buffer = Buffer.isBuffer(stickerData) ? stickerData : stickerData?.url;
        if (!buffer) return content;
        const {
            background,
            pack = config.sticker.packname,
            author = config.sticker.author,
            type = WASF.StickerTypes.FULL,
            categories = ["🌕"],
            id = Date.now().toString(),
            quality = 50,
            ...rest
        } = options;
        const built = await new WASF.Sticker(buffer, {
            pack,
            author,
            type,
            categories,
            id,
            quality,
            background
        }).build();
        return {
            sticker: built,
            ...rest
        };
    }

    async _processContacts(content) {
        if (!content?.contacts) return content;
        const contacts = Array.isArray(content.contacts) ? content.contacts : content.contacts?.contacts || [content.contacts];
        const parsed = contacts.map(contact => {
            if (contact.vcard) return contact;
            if (contact.number) {
                const clean = contact.number.toString().replace(/\s/g, "");
                const vcard = vCard.generate({
                    version: [{
                        value: "3.0"
                    }],
                    fn: [{
                        value: contact.displayName || "nirwabot"
                    }],
                    org: [{
                        value: [contact.org || ""]
                    }],
                    tel: [{
                        value: `+${clean}`,
                        meta: {
                            type: ["CELL", "VOICE"],
                            waid: [clean]
                        }
                    }]
                });
                return {
                    displayName: contact.displayName || "nirwabot",
                    vcard
                };
            }
            return null;
        }).filter(Boolean);
        if (!parsed.length) return content;
        return {
            contacts: Array.isArray(content.contacts) && !content.contacts?.contacts ? {
                displayName: "nirwabot",
                contacts: parsed
            } : {
                displayName: content.contacts?.displayName || "nirwabot",
                contacts: parsed
            }
        };
    }

    async _processStickerPack(content, options) {
        if (!content?.stickerPack) return content;
        const {
            stickers,
            name = "Sticker Pack",
            publisher = config.bot.name,
            description = "",
            cover,
            ...rest
        } = content.stickerPack;
        delete content.stickerPack;
        const defaultOpts = {
            pack: options.pack || config.sticker.packname,
            author: options.author || config.sticker.author,
            quality: options.quality || 50,
            type: options.type || WASF.StickerTypes.FULL,
            categories: options.categories || ["🌕"]
        };
        const processed = await Promise.all(stickers.map(async (sticker, index) => {
            const buffer = await new WASF.Sticker(sticker.data, {
                ...defaultOpts,
                ...sticker,
                id: sticker.id || `${Date.now()}-${index}`
            }).build();
            return {
                data: buffer,
                emojis: sticker.emojis || ["🌕"],
                isCover: index === 0 && !cover
            };
        }));
        return {
            name,
            publisher,
            description,
            cover: processed[0].data,
            stickers: processed.map(s => ({
                data: s.data,
                emojis: s.emojis
            })),
            ...rest
        };
    }
}

module.exports = Client;