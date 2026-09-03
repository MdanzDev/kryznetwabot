module.exports = [{
    name: "approve",
    category: "group",
    permissions: {
        admin: true,
        botAdmin: true,
        group: true
    },
    code: async (ctx) => {
        if (ctx.args[0]?.toLowerCase() === "all") {
            const pendings = await ctx.group().pendingMembers();
            if (pendings.length === 0) return await ctx.reply(ctx.format.info("Tidak ada anggota yang menunggu persetujuan."));
            try {
                const allJids = pendings.map(pending => pending.lid);
                await ctx.group().approvePendingMembers(allJids);
                return await ctx.reply(ctx.format.info(`Berhasil menyetujui semua anggota (${allJids.length}).`));
            } catch (error) {
                return await ctx.helper.handleError(ctx, error);
            }
        }

        const target = await ctx.target(["text"]);
        if (!target.id)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "60137345871")}\n` +
                ctx.format.generateNotes([
                    `Ketik ${ctx.format.inlineCode(`${ctx.used.prefix + ctx.used.command} all`)} untuk menyetujui semua anggota yang tertunda.`
                ])
            );

        const pendings = await ctx.group().pendingMembers();
        const isPending = pendings.some(pending => ctx.helper.areJidsSameUser(pending.lid, target.id));
        if (!isPending) return await ctx.reply(ctx.format.info("Akun tidak ditemukan di daftar anggota yang menunggu persetujuan."));
        try {
            await ctx.group().approvePendingMembers(target.id);
            await ctx.reply(ctx.format.info("Berhasil disetujui!"));
        } catch (error) {
            await ctx.helper.handleError(ctx, error);
        }
    }
}, {
    name: "reject",
    category: "group",
    permissions: {
        admin: true,
        botAdmin: true,
        group: true
    },
    code: async (ctx) => {
        if (ctx.args[0]?.toLowerCase() === "all") {
            const pendings = await ctx.group().pendingMembers();
            if (pendings.length === 0) return await ctx.reply(ctx.format.info("Tidak ada anggota yang menunggu persetujuan."));
            try {
                const allJids = pendings.map(pending => pending.lid);
                await ctx.group().rejectPendingMembers(allJids);
                return await ctx.reply(ctx.format.info(`Berhasil menolak semua anggota (${allJids.length}).`));
            } catch (error) {
                return await ctx.helper.handleError(ctx, error);
            }
        }

        const target = await ctx.target(["text"]);
        if (!target.id)
            return await ctx.reply(
                `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                `${ctx.format.generateCmdExample(ctx.used, "60137345871")}\n` +
                ctx.format.generateNotes([
                    `Ketik ${ctx.format.inlineCode(`${ctx.used.prefix + ctx.used.command} all`)} untuk menolak semua anggota yang tertunda.`
                ])
            );

        const pendings = await ctx.group().pendingMembers();
        const isPending = pendings.some(pending => ctx.helper.areJidsSameUser(pending.lid, target.id));
        if (!isPending) return await ctx.reply(ctx.format.info("Akun tidak ditemukan di daftar anggota yang menunggu persetujuan."));
        try {
            await ctx.group().rejectPendingMembers(target.id);
            await ctx.reply(ctx.format.info("Berhasil ditolak!"));
        } catch (error) {
            await ctx.helper.handleError(ctx, error);
        }
    }
}];