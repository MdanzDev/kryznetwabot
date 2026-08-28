const Check = require("./check");
const Track = require("./track");
const Validate = require("./validate");

module.exports = (bot) => {
    Check(bot);
    Track(bot);
    Validate(bot);
};