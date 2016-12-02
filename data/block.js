(function() {
    'use strict'

    var target = [
        "ads_left",
        "left_ads"
    ];

    for (var i = 0; i < target.length; i++) {
        var docker = document.getElementById("side_bar_inner");
        var ads =  document.getElementById(target[i]);

        if (docker && ads) {
            docker.removeChild(ads);
        }
    }
})();