// onboard.js — first-run guide when the bot is added to a group.
//
// WHY THIS EXISTS
// Every discovery feature so far is pull: the user must already know a command
// name to type `.help`. The only push moment available is the bot being added to
// a group. Nothing used it, so a new group got a silent join and the admin never
// learned that `.setwelcome`, `.antilink` or `.close` exist. Live data: 2 of 41
// groups had ever turned on welcome messages, 0 had turned on anything else.
//
// TWO ENTRY POINTS
// baileys fires different events depending on HOW the bot enters a group:
//   - Bot creates a new group     -> `groups.upsert` (rare)
//   - Bot is ADDED to a group     -> `group-participants.update` action:"add"
//                                    -> client.js emits `UserJoin`
// The second is the common case. `groups.upsert` alone caught nothing — that
// was the original bug. Onboard now listens to BOTH.
//
// The `UserJoin` event also fires for every regular member who joins. Onboard
// only acts when the joiner IS the bot itself (checked via PN/LID match, same
// pattern as wa-bridge._botDigits). For non-bot joins, welcome.js handles it.
//
// HOW IT KNOWS A GROUP IS NEW
// Both events also fire on reconnect/boot, so "the event fired" is NOT evidence
// of a fresh install. Two markers:
//   - onboardedGroups: group ids already greeted in THIS process (fast path)
//   - groupDb.onboardedAt: persisted marker, set once. Survives restarts.
// A row with no `onboardedAt` is only treated as new when it also carries no
// other history (no members, no options, no texts). Groups that existed before
// this feature shipped get stamped instead of greeted via migrateExisting().
//
// NOTE: the card must never go through applyPlaceholders — it contains `%tag%`
// as a literal example for `.setwelcome`, and placeholder substitution would
// replace it with a real mention tag and corrupt the instruction.
const { buildPlaceholders } = require("./welcome");

const AUTO_ENABLE_WELCOME = true;
const SEND_DELAY_MS = 2000;

const onboardedGroups = new Set();
let migrationComplete = false;
const pendingGroups = new Set();

// Bot identity: PN JID + LID. The bot has two identities and may be addressed
// by either depending on the group's addressing mode.
function botDigits(bot) {
    const core = bot.core;
    const ids = new Set();
    const bare = (jid) => String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
    const pn = core?.user?.id;
    const lid = core?.user?.lid || core?.authState?.creds?.me?.lid;
    for (const jid of [pn, lid]) { const d = bare(jid); if (d) ids.add(d); }
    return ids;
}

// A group with no history at all is indistinguishable from a fresh install. Both
// cases are safe to greet, but only the first run needs protecting: existing
// groups are stamped once so they are never greeted retroactively.
function hasHistory(groupDb) {
    return Boolean(
        (groupDb?.members?.length) ||
        (groupDb?.text && Object.keys(groupDb.text).length) ||
        (groupDb?.option && Object.keys(groupDb.option).some(k => groupDb.option[k]))
    );
}

function guideCard(prefix, botName) {
    const c = (s) => `\`${prefix}${s}\``;
    return "╭───────────────୨୧\n" +
        "│  ₊˚⊹♡  𝐌𝐔𝐋𝐀 𝐒𝐈𝐍𝐈!  ♡⊹˚₊\n" +
        `│ (｡･ω･｡)ﾉ♡ Aku ${botName}, dah masuk grup ni\n` +
        "╰───────────────୨୧\n\n" +
        "╭┈┈┈┈┈┈┈┈୨୧\n" +
        "┊ ✦ 𝐀𝐃𝐌𝐈𝐍 𝐆𝐑𝐔𝐏 — 𝐏𝐀𝐋𝐈𝐍𝐆 𝐒𝐄𝐑𝐈𝐍𝐆 𝐆𝐔𝐍𝐀 ୨୧\n┊\n" +
        `┊ ❖ Sambutan member baru\n┊    ♡ ${c("welcome")} · ${c("setwelcome Halo %tag%!")}\n` +
        `┊ ❖ Halang link / spam\n┊    ♡ ${c("antilink")} · ${c("antispam")}\n` +
        `┊ ❖ Tutup grup\n┊    ♡ ${c("close")} · ${c("open")}\n` +
        `┊ ❖ Bagi warning / keluarkan\n┊    ♡ ${c("warn @user")} · ${c("kick @user")}\n` +
        `┊ ❖ Buang ahli paling sepi\n┊    ♡ ${c("kickidle 10")}\n` +
        `┊ ❖ Tag semua orang\n┊    ♡ ${c("tagall Kumpul sini!")}\n` +
        "╰┈┈┈┈┈┈┈┈୨୧\n\n" +
        "╭┈┈┈┈┈┈┈┈୨୧\n" +
        "┊ ✦ 𝐁𝐀𝐍𝐓𝐔𝐀𝐍 ୨୧\n┊\n" +
        `┊ ❖ ${c("help")} — panduan mula\n` +
        `┊ ❖ ${c("menu")} — semua perintah\n` +
        `┊ ❖ ${c("setoption status")} — tetapan grup ni\n` +
        "╰┈┈┈┈┈┈┈┈୨୧";
}

// One-time stamp for groups that existed before this feature, so they are never
// greeted retroactively. Runs on the first `ready` of a process.
async function migrateExisting(bot) {
    try {
        const botDb = bot.getDb("bot");
        if (botDb?.onboardMigrationDone) return;

        const groups = await Promise.race([
            bot.core.groupFetchAllParticipating(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("groupFetch timeout")), 15000))
        ]);
        let stamped = 0;
        for (const group of Object.values(groups)) {
            const groupDb = bot.getDb("groups", group.id);
            if (!groupDb.onboardedAt) {
                groupDb.onboardedAt = Date.now();
                groupDb.save();
                stamped++;
            }
        }
        botDb.onboardMigrationDone = true;
        botDb.save();
        console.log(`[onboard] migration: ${stamped} existing group(s) marked as already onboarded`);
    } catch (error) {
        // Do not set the flag on failure: the next ready retries.
        console.error("[onboard] migration failed:", error.message);
        return;
    }

    // Migration is authoritative now; release anything that arrived early.
    migrationComplete = true;
    const queued = [...pendingGroups];
    pendingGroups.clear();
    for (const groupId of queued) await onboardGroup(bot, groupId);
}

async function onboardGroup(bot, groupId) {
    if (onboardedGroups.has(groupId)) return;
    const groupDb = bot.getDb("groups", groupId);
    if (groupDb.onboardedAt) {
        onboardedGroups.add(groupId);
        return;
    }
    onboardedGroups.add(groupId);

    // A group that already has members/options/texts is not a fresh install.
    // Stamp it so a duplicate event can never greet it.
    if (hasHistory(groupDb)) {
        groupDb.onboardedAt = Date.now();
        groupDb.save();
        return;
    }

    try {
        await new Promise(r => setTimeout(r, SEND_DELAY_MS));
        const botDb = bot.getDb("bot");
        const prefix = botDb?.lastPrefix || config.bot?.prefix || ".";

        // Turn welcome on so the group is useful from the first join. Set BEFORE
        // the card is sent so the card's claim is already true.
        if (AUTO_ENABLE_WELCOME) {
            (groupDb.option ||= {}).welcome = true;
        }
        groupDb.onboardedAt = Date.now();
        groupDb.save();

        const text = guideCard(prefix, config.bot?.name || "Bot");

        await bot.sendMessage(groupId, {
            text,
            footer: config.msg?.footer,
            buttons: [
                { text: "♡ Panduan Mula", id: `${prefix}help` },
                { text: "୨୧ Semua Perintah", id: `${prefix}menu` }
            ]
        });
        console.log(`[onboard] greeted new group ${String(groupId).split("@")[0].slice(-6)} (welcome auto-enabled)`);
    } catch (error) {
        // Keep the marker set: a failed greeting must not retry forever and spam
        // the group on every reconnect.
        console.error("[onboard] failed for", groupId, error.message);
    }
}

// Try to onboard a group. Called from both entry points. Queued until migration
// has stamped pre-existing groups, so a bare existing row is never greeted.
function tryOnboard(bot, groupId) {
    if (!groupId) return;
    if (!migrationComplete) { pendingGroups.add(groupId); return; }
    onboardGroup(bot, groupId).catch(() => {});
}

module.exports = (bot) => {
    // Entry 1: bot is ADDED to an existing group (the common case).
    // group-participants.update action:"add" -> client.js emits UserJoin for
    // each participant. We only act when the joiner is the bot itself.
    bot.ev.on("UserJoin", (welcome) => {
        if (!welcome?.id || !welcome?.participant) return;
        const ids = botDigits(bot);
        if (!ids.size) return;
        const joiner = String(welcome.participant).split("@")[0].split(":")[0].replace(/\D/g, "");
        if (!ids.has(joiner)) return;         // not the bot -> let welcome.js handle it
        tryOnboard(bot, welcome.id);
    });

    // Entry 2: bot CREATES a new group (rare).
    bot.ev.on("groups.upsert", (events) => {
        for (const event of (Array.isArray(events) ? events : [events])) {
            if (event?.id) tryOnboard(bot, event.id);
        }
    });

    // Stamp pre-existing groups before any event can greet them.
    bot.ev.once("ClientReady", () => migrateExisting(bot).catch(() => {}));
};

module.exports.onboardGroup = onboardGroup;
module.exports.migrateExisting = migrateExisting;
module.exports.hasHistory = hasHistory;
module.exports.guideCard = guideCard;
module.exports.onboardedGroups = onboardedGroups;
