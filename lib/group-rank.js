// Ranking + idle-pruning for group members.
//
// WHY ONE SHARED RANKING
// `sent` in database/groups.json is a counter that only starts when a member is
// first seen talking (events/messages.js creates the row with sent: 1). Live
// data proves the consequence: across 711 tracked rows in 41 groups the minimum
// is 1, so the old .topsider — which ranked ONLY tracked rows ascending — listed
// the members who joined the tracking window most recently, not the quiet ones.
// A member who never talks has no row at all and was invisible to it.
//
// So the authoritative member list is the WhatsApp metadata, `sent` is looked up
// per member and defaults to 0. That makes "who talks least" mean what it says,
// and it is the same number .kickidle acts on — the two can never disagree.

const KICK_BATCH_SIZE = 10;      // members per groupParticipantsUpdate call
const KICK_BATCH_DELAY_MS = 1500; // pause between batches
// Hard ceiling per run. Not a UX preference: removing hundreds of participants
// in one burst is how a WhatsApp number gets banned, and this number has been
// banned before. Re-run the command to continue past it.
const KICK_MAX_PER_RUN = 30;
const CONFIRM_WINDOW_MS = 60000;
const CONFIRM_WORDS = ["ya", "yes", "y", "confirm", "kick", "buang", "sah"];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Authoritative roster + activity, one row per current participant.
// Also prunes tracked rows for members who have left (the old TopHandler did
// this cleanup inline; it belongs here now that three commands need it).
async function buildRanking(ctx) {
    const participants = (await ctx.group().members()) || [];
    const tracked = ctx.db.group?.members || [];

    const rows = participants
        .filter(p => p?.id)
        .map(p => {
            const rec = tracked.find(m => ctx.helper.areJidsSameUser(m.id, p.id));
            return {
                id: p.id,
                name: rec?.pushName || ctx.getId(p.id),
                sent: rec?.sent || 0,
                firstSeen: rec?.firstSeen || null,
                isAdmin: Boolean(p.admin),
                isGroupOwner: p.admin === "superadmin",
                isBot: ctx.helper.areJidsSameUser(p.id, ctx.me.lid)
            };
        });

    const kept = tracked.filter(m => rows.some(r => ctx.helper.areJidsSameUser(r.id, m.id)));
    if (kept.length !== tracked.length) {
        ctx.db.group.members = kept;
        ctx.db.group.save();
    }
    return rows;
}

// Ascending = least active first. Ties broken by name so the order is stable
// across runs (an unstable order would make repeated previews look random).
function sortByActivity(rows, direction) {
    return [...rows].sort((a, b) =>
        (direction === "asc" ? a.sent - b.sent : b.sent - a.sent) ||
        String(a.name).localeCompare(String(b.name)));
}

// Who is eligible to be removed for inactivity. Admins and the bot itself are
// never candidates — an admin who is quiet is still an admin, and removing the
// bot ends the session.
function idleCandidates(rows, limit) {
    return sortByActivity(rows.filter(r => !r.isBot && !r.isAdmin), "asc").slice(0, limit);
}

function ageLabel(firstSeen) {
    if (!firstSeen) return "tiada rekod";
    const days = Math.floor((Date.now() - firstSeen) / 86400000);
    if (days >= 1) return `${days} hari`;
    const hours = Math.floor((Date.now() - firstSeen) / 3600000);
    return hours >= 1 ? `${hours} jam` : "baru";
}

module.exports = {
    KICK_BATCH_SIZE,
    KICK_BATCH_DELAY_MS,
    KICK_MAX_PER_RUN,
    CONFIRM_WINDOW_MS,
    CONFIRM_WORDS,
    sleep,
    buildRanking,
    sortByActivity,
    idleCandidates,
    ageLabel
};
