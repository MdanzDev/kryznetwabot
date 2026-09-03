module.exports = {
    name: "getstatus",
    aliases: ["status", "fetchstatus"],
    category: "misc",
       permissions: {
        owner: true
    },

    code: async (ctx) => {
        const target = await ctx.target();

        if (!target.id)
            return await ctx.reply({
                text:
                    `${ctx.format.generateInstruction(["send"], ["text"])}\n` +
                    `${ctx.format.generateCmdExample(ctx.used, "@60137345871")}\n` +
                    ctx.format.generateNotes([
                        "Balas/quote pesan untuk menjadikan pengirim sebagai akun target."
                    ]),
                mentions: ["60137345871@s.whatsapp.net"]
            });

        try {
            const statuses =
                await ctx.core.fetchStatusUpdates(target.id);

            if (!statuses.length)
                return await ctx.reply({
                    text:
                        `❖ Tidak ada status foto/video ditemukan untuk @${ctx.getId(target.id)}`,
                    mentions: [target.id]
                });

            let sent = 0;

            for (const status of statuses) {
                try {
                    const media =
                        await ctx.core.downloadStatus(status);

                    if (!media)
                        continue;

                    const caption =
                        media.message?.message?.imageMessage?.caption ||
                        media.message?.message?.videoMessage?.caption ||
                        "";

                    const captionText =
                        caption
                            ? `❖ @${ctx.getId(target.id)}\n\n${caption}`
                            : `❖ @${ctx.getId(target.id)}`;

                    if (media.type === "image") {
                        await ctx.reply({
                            image: media.buffer,
                            caption: captionText,
                            mentions: [target.id]
                        });
                    }

                    else if (media.type === "video") {
                        await ctx.reply({
                            video: media.buffer,
                            caption: captionText,
                            mentions: [target.id]
                        });
                    }

                    sent++;
                }

                catch (error) {
                    console.error(
                        "[getstatus] Failed to download status:",
                        error
                    );
                }
            }

            if (!sent) {
                return await ctx.reply({
                    text:
                        `❖ Status dijumpai tetapi media gagal dimuat untuk @${ctx.getId(target.id)}.`,
                    mentions: [target.id]
                });
            }
        }

        catch (error) {
            await ctx.helper.handleError(ctx, error);
        }
    }
};