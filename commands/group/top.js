// .topyapping / .topsider — activity leaderboards.
//
// Ranking lives in lib/group-rank.js and is shared with .kickidle so the board
// and the kick decision can never disagree.
const { buildRanking, sortByActivity, ageLabel } = require("../../lib/group-rank");

const BOARD_SIZE = 10;

class TopHandler {
    constructor(option) {
        this.name = option.name;
        this.aliases = option.aliases;
        this.sortDirection = option.sortDirection;
        this.title = option.title;
        this.permissions = {
            group: true
        };
    }

    async handle(ctx) {
        const rows = await buildRanking(ctx);
        // The bot is a member of its own group and always has 0 recorded
        // messages, so it would otherwise top every "quietest" board.
        const humans = rows.filter(r => !r.isBot);
        const sorted = sortByActivity(humans, this.sortDirection);
        const board = sorted.slice(0, BOARD_SIZE);

        if (!board.length) return await ctx.reply(ctx.format.info("Tiada data ahli untuk dipaparkan."));

        // Counts are per-message, and tracking only starts when a member is first
        // seen. Say so rather than implying it is their whole history.
        const never = humans.filter(r => r.sent === 0).length;

        let text = "╭───────────────୨୧\n" +
            `│  ₊˚⊹♡  ${this.title}  ♡⊹˚₊\n` +
            `│ (｡･ω･｡)ﾉ♡ ${humans.length} ahli · ${never} belum pernah bersuara\n` +
            "╰───────────────୨୧\n\n";

        const mentions = [];
        board.forEach((member, i) => {
            const isSelf = ctx.helper.areJidsSameUser(member.id, ctx.sender.lid);
            let displayName = member.name;
            if (isSelf) {
                displayName = `@${ctx.getId(member.id)}`;
                mentions.push(member.id);
            }
            if (member.isGroupOwner) displayName += " 👑";
            else if (member.isAdmin) displayName += " 🛡️";
            const rank = i < 3 ? "❖" : `❖ ${i + 1}.`;
            const age = member.firstSeen ? ` · sejak ${ageLabel(member.firstSeen)}` : "";
            text += `${rank} ${displayName} — ${member.sent} pesan${age}\n`;
        });

        await ctx.reply({
            text: text.trim(),
            mentions
        });
    }
}

const options = {
    topsider: {
        name: "topsider",
        aliases: ["sider"],
        sortDirection: "asc",
        title: "𝑷𝒂𝒍𝒊𝒏𝒈 𝑺𝒆𝒏𝒚𝒂𝒑"
    },
    topyapping: {
        name: "topyapping",
        aliases: ["yapping"],
        sortDirection: "desc",
        title: "𝑷𝒂𝒍𝒊𝒏𝒈 𝑩𝒂𝒏𝒚𝒂𝒌 𝑪𝒉𝒂𝒕"
    }
};

module.exports = Object.entries(options).map(([name, option]) => {
    const handler = new TopHandler(option);
    return {
        name: handler.name,
        aliases: handler.aliases,
        category: "group",
        permissions: handler.permissions,
        code: async (ctx) => await handler.handle(ctx)
    };
});
