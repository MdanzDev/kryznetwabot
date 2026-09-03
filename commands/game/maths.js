const sessions = new Map();

const levelBonus = {
    noob: 10,
    easy: 25,
    medium: 50,
    hard: 100,
    extreme: 250,
    impossible: 500,
    impossible2: 750,
    impossible3: 1000,
    impossible4: 1500,
    impossible5: 2000
};
const levels = {
    noob: "Noob",
    easy: "Mudah",
    medium: "Sedang",
    hard: "Sulit",
    extreme: "Ekstrim",
    impossible: "Mustahil",
    impossible2: "Mustahil II",
    impossible3: "Mustahil III",
    impossible4: "Mustahil IV",
    impossible5: "Mustahil V"
};

module.exports = {
    name: "maths",
    category: "game",
    code: async (ctx) => {
        if (sessions.has(ctx.id)) return await ctx.reply(ctx.format.info("Sesi permainan sedang berjalan!"));

        try {
            const input = ctx.args?.[0] && levels.hasOwnProperty(ctx.args[0]) ? ctx.args[0] : "random";
            const apiUrl = ctx.api.createUrl("siputzx", "/api/games/maths", {
                level: input
            });
            const result = (await ctx.request.get(apiUrl)).data.data;

            const game = {
                coin: levelBonus[input] || 100,
                timeout: result.time,
                answer: String(result.result)
            };

            sessions.set(ctx.id, true);

            const promptText =
                "╭───────────────୨୧\n" +
                "│  ₊˚⊹♡  𝑴𝒂𝒕𝒉 𝑸𝒖𝒊𝒛  ♡⊹˚₊\n" +
                `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა Selesaikan soal ini yuk!\n` +
                `│ ✦ Soal › ${ctx.format.bold(result.str)}\n` +
                "╰───────────────୨୧\n\n" +
                "╭┈┈┈┈┈┈┈┈୨୧\n" +
                "┊ ✦ 𝑰𝒏𝒇𝒐 𝑺𝒐𝒂𝒍 ୨୧\n" +
                `┊ ♡ Level › ${levels[result.mode]}\n` +
                `┊ ♡ Bonus › +${game.coin} koin\n` +
                `┊ ♡ Waktu › ${ctx.format.convertMsToDuration(game.timeout)}\n` +
                "╰┈┈┈┈┈┈┈┈୨୧\n\n" +
                "╭───────────────୨୧\n" +
                "│ (｡•̀ᴗ-)✧ Kirim jawabanmu langsung ya! ♡\n" +
                "╰───────────────୨୧";

            await ctx.reply({
                text: promptText,
                buttons: [{
                    text: "୨୧ Menyerah",
                    id: `surrender_${ctx.used.command}`
                }]
            });

            const collector = ctx.MessageCollector({
                time: game.timeout
            });
            const playAgain = [{
                text: "♡ Main Lagi",
                id: `${ctx.used.prefix + ctx.used.command} ${input}`
            }, {
                text: "୨୧ Cek Koin",
                id: `${ctx.used.prefix}coin`
            }];

            collector.on("collect", async (collCtx) => {
                const participantAnswer = collCtx.msg.body?.toLowerCase();
                const participantDb = collCtx.db.user;
                const isUnlimited = collCtx.sender.isOwner() || participantDb?.premium;

                if (participantAnswer === game.answer) {
                    sessions.delete(ctx.id);
                    collector.stop();
                    if (!isUnlimited) participantDb.coin += game.coin;
                    participantDb.winGame += 1;
                    participantDb.save();
                    await collCtx.reply({
                        text: ctx.format.info(`૮ ˶ᵔ ᵕ ᵔ˶ ა Benar sekali! +${game.coin} koin berhasil didapatkan! ♡`),
                        buttons: playAgain
                    });
                } else if (participantAnswer === `surrender_${ctx.used.command}`) {
                    sessions.delete(ctx.id);
                    collector.stop();
                    await collCtx.reply({
                        text: ctx.format.info(`(｡•́︿•̀｡) Kamu menyerah! Jawabannya adalah: ${ctx.format.ucwords(game.answer)}~ ♡`),
                        buttons: playAgain
                    });
                }
            });

            collector.on("end", async () => {
                if (sessions.has(ctx.id)) {
                    sessions.delete(ctx.id);
                    await ctx.reply({
                        text: ctx.format.info(`(｡•́︿•̀｡) Waktu habis! Jawabannya adalah: ${ctx.format.ucwords(game.answer)}~ ♡`),
                        buttons: playAgain
                    });
                }
            });
        } catch (error) {
            sessions.delete(ctx.id);
            await ctx.helper.handleError(ctx, error, true);
        }
    }
};