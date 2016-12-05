(function () {
    'use strict'

    var docker = document.getElementById("side_bar_inner");
    if (!docker) {
        return;
    }

    var target = [
        "ads_left",
        "left_ads"
    ];

    for (var i = 0, len = target.length; i < len; i++) {

        var ads = document.getElementById(target[i]);
        if (ads) {
            docker.removeChild(ads);
        }
    }
})();