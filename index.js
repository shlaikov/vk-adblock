'use strict'


require("sdk/page-mod").PageMod({

    include: "*.vk.com",
    contentScriptFile: "./block.js",

    onAttach: function () {
        var preferences = require("sdk/simple-prefs").prefs;

        if (preferences.possible_friends == true) {

            var narrow_column = document.getElementById("narrow_column");
            var friends_possible = document.getElementById("friends_possible_block");

            if (narrow_column && friends_possible) {
                narrow_column.removeChild(friends_possible);
            }
        }
    }
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