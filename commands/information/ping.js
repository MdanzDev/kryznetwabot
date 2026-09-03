const { SpeedTestService } = require("@ginkohub/speedtest-js");

module.exports = {
    name: "ping",
    aliases: ["p"],
    category: "information",
    code: async (ctx) => {
        const pongMsg = await ctx.reply(ctx.format.info("(｡･ω･｡) Pong! Mengukur kecepatan respon... ✧"));
        try {
            const service = new SpeedTestService();
            await service.fetchClientInfo();
            const bestServer = await service.findBestServer();
            const latencySpeed = (await service.testLatency(bestServer, 5)).latency;

            const text =
                "╭───────────────୨୧\n" +
                "│  ₊˚⊹♡  𝑷𝒐𝒏𝒈!  ♡⊹˚₊\n" +
                `│ ૮ ˶ᵔ ᵕ ᵔ˶ ა Kecepatan respon:\n` +
                `│ ✦ ${ctx.format.convertMsToDuration(latencySpeed)}\n` +
                "│ (｡•̀ᴗ-)✧ Merespon dengan cepat dan stabil! ♡\n" +
                "╰───────────────୨୧";

            await ctx.editMessage(ctx.id, pongMsg.key, text);
        } catch (error) {
            await ctx.editMessage(ctx.id, pongMsg.key, ctx.format.info("૮ ˶ᵔ ᵕ ᵔ˶ ა Pong! Merespon cepat dan lancar~ ♡"));
        }
    }
};