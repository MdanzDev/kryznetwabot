require("./lib/error-handler")();
require("node:process").loadEnvFile();
const { Config } = require("./lib");
const http = require("node:http");
const path = require("node:path");
const util = require("node:util");
const cfonts = require("cfonts");
const pkg = require("./package.json");

Object.assign(global, {
    config: new Config(path.resolve(__dirname, "config.json"))
});

console.log("[*] Starting...");

cfonts.say(pkg.name, {
    colors: ["#00A1E0", "#00FFFF"],
    align: "center"
});
cfonts.say(`${pkg.description} - By ${pkg.author}`, {
    font: "console",
    colors: ["#E0F7FF"],
    align: "center"
});

const { bot } = require("./main");

if (config.system?.useServer) {
    const { createInternalApi } = require("./lib/internal-api");
    createInternalApi({
        bot,
        apiKey: process.env.BOT_API_KEY,
        port: config.system.port
    });
}
