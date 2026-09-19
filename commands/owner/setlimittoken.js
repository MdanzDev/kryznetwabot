module.exports = {
    name: "setlimittoken",
    aliases: ["tokenlimit", "settoken"],
    category: "owner",
    code: async (ctx) => {
        // FIX: ctx.flag.input was empty/undefined — subcommand parsing must
        // come from ctx.text, same as group.js does.
        const input = ctx.text || "";
        const args = input.trim().split(/\s+/);
        const isOwner = ctx.sender.isOwner();

        if (!isOwner) {
            return await ctx.reply(ctx.format.info("(｡•ˇ‸ˇ•｡) Owner je boleh set limit token."));
        }

        const tokenLimiter = require("../../lib/telegram/token-limiter");

        // .setlimittoken <@user/number> <limit>
        // .setlimittoken reset <@user/number>
        // .setlimittoken check <@user/number>
        // .setlimittoken resetall
        if (args[0] === "resetall") {
            tokenLimiter.resetAll();
            return await ctx.reply("✅ Semua token usage dah direset.");
        }

        if (args[0] === "reset") {
            const target = args[1]?.replace(/@|[^0-9]/g, "");
            if (!target) return await ctx.reply("❌ Format: .setlimittoken reset <@user>");
            tokenLimiter.resetUser(target);
            return await ctx.reply(`✅ Token usage untuk ${target} dah direset.`);
        }

        if (args[0] === "check") {
            const target = args[1]?.replace(/@|[^0-9]/g, "") || ctx.getId(ctx.sender.jid);
            const used = tokenLimiter.getUsed(target);
            const limit = tokenLimiter.getLimit(target, false, false);
            const remaining = Math.max(0, limit - used);
            return await ctx.reply(
                `❖ User: ${target}\n` +
                `♡ Limit: ${limit === 0 ? "Unlimited" : limit}\n` +
                `♡ Used: ${used}\n` +
                `♡ Remaining: ${remaining}`
            );
        }

        // Set limit: .setlimittoken <@user> <number>
        const target = args[0]?.replace(/@|[^0-9]/g, "");
        const limit = parseInt(args[1], 10);
        if (!target || !limit || limit < 0) {
            return await ctx.reply(
                "❖ Format:\n" +
                ".setlimittoken <@user> <limit> — set daily limit\n" +
                ".setlimittoken check <@user> — check usage\n" +
                ".setlimittoken reset <@user> — reset user\n" +
                ".setlimittoken resetall — reset semua\n\n" +
                "Default: Premium 50k, Regular 15k, Owner unlimited"
            );
        }

        tokenLimiter.setLimit(target, limit);
        return await ctx.reply(`✅ Daily limit untuk ${target}: ${limit} tokens`);
    }
};
