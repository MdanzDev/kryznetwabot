// onboard.js — first-run guide when the bot is added to a group.
//
// WHY THIS EXISTS
// Every discovery feature so far is pull: the user must already know a command
// name to type `.help`. The only push moment available is the bot being added to
// a group, which baileys reports through `groups.upsert`. Nothing used it, so a
// new group got a silent join and the admin never learned that `.setwelcome`,
// `.antilink` or `.close` exist. Live data: 2 of 41 groups had ever turned on
// welcome messages, 0 had turned on anything else.
//
// HOW IT KNOWS A GROUP IS NEW
// `groups.upsert` also fires on reconnect and on boot, so "the event fired" is
// NOT evidence of a fresh install. Two markers, because they cover different
// cases:
//   - onboardedGroups: group ids already greeted in THIS process (fast path,
//     covers a duplicate event for the same join)
//   - groupDb.onboardedAt: persisted marker, set once. Survives restarts.
// A row with no `onboardedAt` is only treated as new when it also carries no
// other history (no members, no options, no texts) AND `system.startedAt` is
// unset — see migrateExisting(). Groups that already existed before this feature
// shipped get stamped instead of greeted.
// A group with no history at all is indistinguishable from a fresh install. Both
// cases are safe to greet, but only the first run needs protecting: existing
// groups are stamped once so they are never greeted retroactively.
//
// NOTE: the card must never go through applyPlaceholders — it contains `%tag%`
// as a literal example for `.setwelcome`, and placeholder substitution would
// replace it with a real mention tag and corrupt the instruction.
const { buildPlaceholders } = require("./welcome");

const AUTO_ENABLE_WELCOME = true;
// Give the WA socket a moment before sending; a message pushed immediately after
// the join event can be sent before the session is fully usable.
const SEND_DELAY_MS = 2000;

const onboardedGroups = new Set();
// `groups.upsert` can arrive DURING connection, before ClientReady runs the
// migration. Greeting then would spam existing groups that happen to have no
// history yet (10 of the 41 current rows). Until the migration has stamped
// everything, incoming group ids are queued and processed after it.
let migrationComplete = false;
const pendingUpserts = new Set();

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
    const queued = [...pendingUpserts];
    pendingUpserts.clear();
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

module.exports = (bot) => {
    bot.ev.on("groups.upsert", (events) => {
        for (const event of (Array.isArray(events) ? events : [events])) {
            if (!event?.id) continue;
            if (!migrationComplete) { pendingUpserts.add(event.id); continue; }
            onboardGroup(bot, event.id).catch(() => {});
        }
    });
    // Stamp pre-existing groups before any upsert can arrive. The bot's own
    // ready event is "ClientReady" (see events/ready.js) — there is no "ready".
    bot.ev.once("ClientReady", () => migrateExisting(bot).catch(() => {}));
};

module.exports.onboardGroup = onboardGroup;
module.exports.migrateExisting = migrateExisting;
module.exports.hasHistory = hasHistory;
module.exports.guideCard = guideCard;
module.exports.onboardedGroups = onboardedGroups;
