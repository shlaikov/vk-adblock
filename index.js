'use strict'

var pageMod = require("sdk/page-mod");

pageMod.PageMod({
    include: "*.vk.com",
    contentScriptFile: "./block.js"
});


var buttons = require('sdk/ui/button/action');
var tabs = require("sdk/tabs");

var button = buttons.ActionButton({
    id: "github-link",
    label: "Visit my GitHub",
    icon: {
        "16": "./icons/icon-16.png",
        "32": "./icons/icon-32.png",
        "64": "./icons/icon-64.png"
    },
    onClick: handleClick
});

function handleClick(state) {
    tabs.open("https://github.com/shlaikov/vk-adblock");
}
