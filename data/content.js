"use strict"


const {
    Cc,
    Ci,
    Cu,
    CC
} = require('chrome');
const tabs = require("sdk/tabs");
const self = require("sdk/self");
const io = require("sdk/io/file");
const pageMod = require("sdk/page-mod");

var url = require("sdk/url");
var utils = require('sdk/window/utils');
var Request = require("sdk/request").Request;
var system = require("sdk/system");
var preferences = require("sdk/simple-prefs").prefs;
var notifications = require("sdk/notifications");
var ID3Writer = require('browser-id3-writer');
var XmlEntities = require('html-entities').XmlEntities;
var entities = new XmlEntities();


Cu.import("resource://gre/modules/Downloads.jsm");
Cu.import("resource://gre/modules/osfile.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.importGlobalProperties(['URL']);

var nsIFilePicker = Ci.nsIFilePicker;
var fp = Cc["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
var parser = Cc["@mozilla.org/xmlextras/domparser;1"].createInstance(Ci.nsIDOMParser);
var group_download_dir = Cc["@mozilla.org/file/local;1"]
    .createInstance(Ci.nsILocalFile);

var {
    setTimeout
} = require('sdk/timers');


pageMod.PageMod({
    include: "*.vk.com",
    contentStyleFile: self.data.url("tooltip.css"),
    contentScriptFile: [self.data.url("content.js")],
    contentScriptWhen: "ready",
    onAttach: worker => {

        require("sdk/simple-prefs").on("show_bitrate", function (pref_name) {
            worker.port.emit("do_show_bitrate", preferences["show_bitrate"]);
        })

        worker.port.on("download_track", track => {

            if (preferences["show_single_dialog"]) {
                let dir = make_download_path("single", preferences["show_single_dialog"], "", track["artist"] + " - " + track["title"] + ".mp3");
                if (!dir)
                    return;

                track["filename"] = io.basename(dir).replace(/\.mp3$/, "");
                track["dir"] = io.dirname(dir);
            } else {
                track["dir"] = make_download_path("single", preferences["show_single_dialog"]);
            }

            if (track["dir"]) {
                if (track["claimed"]) {
                    find_track_with_the_best_bitrate_and_download_it(track, false);
                } else {
                    prepare_to_download_track(track, false);
                }
            }

        });

        worker.port.on("get_bitrate", info => {
            get_bitrate(info)
                .then(result => {
                    worker.port.emit("yourBitrateSir", result);
                });
        });

        worker.port.on("get_bitrates", info_array => {
            get_bitrates(info_array)
                .then(result => {
                    worker.port.emit("yourBitratesSir", result);
                });
        });

        worker.port.on("download_vk_album", info => {
            get_vk_album_items(info)
                .then(tracks => {

                    if (preferences["get_album"]) {
                        tracks[0]["vk_artist_albumTitle"] = info["vk_artist_albumTitle"];
                        start_download_album(tracks);
                    } else {
                        let dir = make_download_path("group", preferences["show_group_dialog"],
                            entities.decode(info["vk_artist_albumTitle"]));
                        if (!dir)
                            return;

                        result.forEach(track => {
                            track["dir"] = dir;
                            if (track["claimed"]) {
                                find_track_with_the_best_bitrate_and_download_it(track, false);
                            } else {
                                prepare_to_download_track(track, false);
                            }
                        });
                    }

                });
        });

        worker.port.on("initialize_show_bitrate", () => {
            worker.port.emit("do_show_bitrate", preferences["show_bitrate"]);
        });


        worker.port.on("download_all_user_tracks", info => {
            download_all_user_tracks(info["user_id"], info["remixsid"]);
        });

        worker.port.on("get_album", tracks => {

            if (preferences["get_album"]) {
                start_download_album(tracks);
            } else {
                let dir = make_download_path("group", preferences["show_group_dialog"]);
                if (!dir)
                    return;

                tracks.forEach(track => {
                    track["dir"] = dir;
                    if (track["claimed"]) {
                        find_track_with_the_best_bitrate_and_download_it(track, false);
                    } else {
                        prepare_to_download_track(track, false);
                    }
                });
            }

        });

    }
});




function get_vk_album_items(info) {

    return new Promise((resolve, reject) => {

        Request({
            url: "https://vk.com/al_audio.php",
            headers: {
                Host: "vk.com",
                Cookie: info["remixsid"]
            },
            content: {
                album_id: info['album_id'],
                owner_id: info["owner_id"],
                al: "1",
                act: "load_silent",
                band: 'false'
            },
            onComplete: response => {
                let content = response.text;
                let jstr = content.substring(content.indexOf("[["),
                    content.indexOf("]],") + 2);
                let parsed = "";
                try {
                    let arr = [];
                    parsed = JSON.parse(jstr);
                    for (let i of parsed) {
                        let track_info = {
                            title: entities.decode(i[3]),
                            artist: entities.decode(i[4]),
                            remixsid: info["remixsid"],
                            id: i[1] + "_" + i[0]
                        }
                        arr.push(track_info);
                    }

                    resolve(arr);
                } catch (err) {
                    console.log(err.name + err.message);
                }
            }
        }).post();
    });
}



function find_track_with_the_best_bitrate_and_download_it(track, set_tags = false, timeout = 0) {
    find_track(track, "audio")
        .then(result => {
            find_track(track, "statuses", result["vk_stuff"])
                .then(result => {

                    setTimeout(() => {
                        get_jtracks_bitrate(result)
                            .then(jtrack_with_best_bitrate => {
                                prepare_to_download_track(jtrack_with_best_bitrate, set_tags);
                            });
                    }, timeout);
                });
        });
}

function prepare_to_download_track(info, set_tags = false) {

    info["title"] = entities.decode(info["title"]);
    info["artist"] = entities.decode(info["artist"]);

    Request({
        url: "https://vk.com/al_audio.php",
        headers: {
            Host: "vk.com",
            Cookie: info["remixsid"]
        },
        content: {
            act: 'reload_audio',
            ids: info["id"] + "," + info["id"],
            al: "1"
        },
        onComplete: response => {

            try {
                let content = response.text;
                let jstr = content.substring(content.indexOf("[["),
                    content.indexOf("]]<!>") + 2);

                let parsed = JSON.parse(jstr);
                let url = parsed[0][2];
                let dir = info["dir"];

                if (set_tags) {

                    let filename = info["position"] + ". " + info["title"];
                    filename = make_filename(filename, dir);
                    download_track(url, dir, filename, info);

                } else {
                    info = clean_track_titles([info])[0];
                    let filename = make_filename(info["filename"] || info["artist"] + " - " + info["title"], dir);
                    download_track(url, dir, filename);
                }
            } catch (e) {
                console.log(e.name + " " + e.message);
            }
        }
    }).post();
}



function set_tags(path, info) {

    OS.File.read(path, {}).then(data => {

        let writer = new ID3Writer(data);
        writer.setFrame('TIT2', info["title"])
            .setFrame('TALB', info["album_title"])
            .setFrame('TRCK', info["position"])
            .setFrame('TPE1', info["artists"])
            .setFrame('TPE2', info["artist"])
            .setFrame('TYER', info["year"]);
        writer.addTag();
        OS.File.writeAtomic(path, new Uint8Array(writer.arrayBuffer), {});
    });
}


function download_track(url, dir, filename, info = null) {

    Task.spawn(function () {

        let list;
        let browserWindow = utils.getMostRecentBrowserWindow();

        if (require("sdk/private-browsing").isPrivate(utils.getToplevelWindow(browserWindow))) {
            list = yield Downloads.getList(Downloads.PRIVATE);
        } else {
            list = yield Downloads.getList(Downloads.PUBLIC);
        }

        let download = yield Downloads.createDownload({
            source: url,
            target: io.join(dir, filename)
        });
        list.add(download);
        download.start()
            .then(() => {
                if (info)
                    set_tags(io.join(dir, filename), info);
            });
    }).then(null, () => {
        console.log("Download file error")
    });
}




function make_filename(filename, dir) {

    filename = fix_name(filename);

    let path = io.join(dir, filename + ".mp3");
    if (io.exists(path)) {
        for (let c = 1;; c++) {
            path = io.join(dir, filename + `(${c})` + ".mp3");
            if (!io.exists(path)) {
                filename = filename + `(${c})`;
                break;
            }
        }
    }

    filename = filename + ".mp3";
    return filename;
}

function fix_name(name) {

    if (system.platform == "winnt") {
        name = name.replace(/[<>/*?:\\|"]/g, "");
    } else {
        name = name.replace(/\//g, "");
    }

    return name;
}

function make_download_path(mode, show_dialog = false, additional_part = "", filename = "") {

    try {

        let dir;

        if (mode == "single") {
            if (is_path_existed(preferences["single_download_dir"])) {
                dir = preferences["single_download_dir"];
            } else {
                dir = FileUtils.getDir("DfltDwnld", []).path;
            }
        } else {

            if (is_path_existed(preferences["group_download_dir"])) {
                dir = preferences["group_download_dir"];
            } else if (is_path_existed(preferences["single_download_dir"])) {
                dir = preferences["single_download_dir"];
            } else {
                dir = FileUtils.getDir("DfltDwnld", []).path;
            }

            additional_part = fix_name(additional_part);
            dir = io.join(dir, additional_part);
            if (!io.exists(dir))
                io.mkpath(dir);
        }

        if (show_dialog) {

            let browserWindow = utils.getMostRecentBrowserWindow();
            if (mode == "single") {
                fp.init(utils.getToplevelWindow(browserWindow), "Save as", nsIFilePicker.modeSave);
                fp.defaultString = filename;
                fp.appendFilters(nsIFilePicker.filterAll);
            } else {
                fp.init(utils.getToplevelWindow(browserWindow), "Select a directory", nsIFilePicker.modeGetFolder);
            }


            group_download_dir.initWithPath(dir);
            fp.displayDirectory = group_download_dir;

            let rv = fp.show();

            if (rv == nsIFilePicker.returnOK || rv == nsIFilePicker.returnReplace) {
                if (mode != 'single' && dir != fp.file.path && additional_part != "") {
                    try {
                        io.rmdir(dir);
                    } catch (e) {}
                }
                dir = fp.file.path;
            } else {
                if (additional_part != "") {
                    try {
                        io.rmdir(dir);
                    } catch (e) {}
                }
                return;
            }

        }

        if (!io.exists(dir) && !filename)
            io.mkpath(dir);

        return dir;
    } catch (e) {
        console.log(e.name + e.message);
    }
}




function clean_track_titles(tracks) {
    let clean_tracks = [];
    for (let track of tracks) {
        for (let symbol of "{[") {
            if (track["title"].indexOf(symbol) > 0)
                track["title"] = track["title"].slice(0, track["title"].indexOf(symbol));
        }
        track["title"] = track["title"].trim();
        clean_tracks.push(track);
    }

    return clean_tracks;
}


function compare_durations(discog_duration, vk_duration) {

    if (!discog_duration)
        return true;

    let ms_discog_duration;
    if (typeof discog_duration == "number") {
        ms_discog_duration = discog_duration;
    } else {
        let split_discog_duration = discog_duration.split(":");
        ms_discog_duration = (parseInt(split_discog_duration[0]) * 60 + parseInt(split_discog_duration[1])) * 1000;
    }

    let split_vk_duration = vk_duration.split(":");
    let ms_vk_duration = (parseInt(split_vk_duration[0]) * 60 + parseInt(split_vk_duration[1])) * 1000;


    if (ms_discog_duration == ms_vk_duration) {
        return true;
    } else if (ms_vk_duration < ms_discog_duration) {
        if (ms_vk_duration + 3000 >= ms_discog_duration)
            return true;
    } else if (ms_vk_duration > ms_discog_duration) {
        if (ms_vk_duration - 3000 <= ms_discog_duration)
            return true;
    }
    return false;
}

function start_download_album(tracks) {

    tracks = clean_track_titles(tracks);

    Promise.all([spotify(tracks), discogs(tracks)]).then(
            (result) => {

                if (result.every(i => i == null)) {

                    let dir;
                    if (tracks[0]["vk_artist_albumTitle"]) {
                        dir = make_download_path("group", preferences["show_group_dialog"],
                            entities.decode(tracks[0]["vk_artist_albumTitle"]));
                    } else {
                        dir = make_download_path("group", preferences["show_group_dialog"]);
                    }

                    if (!dir)
                        return;

                    tracks.forEach((track, index) => {
                        track["dir"] = dir;
                        if (track["claimed"]) {
                            find_track_with_the_best_bitrate_and_download_it(track, false, index * 5000);
                        } else {
                            prepare_to_download_track(track, false);
                        }

                    });
                    return;
                }

                try {
                    result.sort();
                    let jplaylist = result[0];
                    let jtracks = [];

                    let dir = make_download_path("group", preferences["show_group_dialog"], jplaylist["artist"] + " - " + jplaylist["album_title"]);
                    if (!dir)
                        return jtracks;


                    for (let c = 0; c < jplaylist.items.length; c++) {
                        let jtrack = jplaylist.items[c];
                        jtrack["dir"] = dir;
                        jtrack["remixsid"] = tracks[0]["remixsid"];
                        let dont_push_to_jtracks = tracks.some(track => {
                            if (!track["claimed"] && compare_tracks_titles(track["title"], jtrack["title"])) {
                                jtrack["id"] = track["id"];
                                prepare_to_download_track(jtrack, true);
                                return true;
                            }
                        });

                        if (!dont_push_to_jtracks) {
                            jtrack["timeout"] = jtracks.length * 4000;
                            jtracks.push(jtrack);
                        }

                    }

                    get_cover(jplaylist["cover"], dir);
                    return jtracks;
                } catch (e) {
                    console.log(e.name + e.message);
                }

            }
        )
        .then(jtracks => {

            jtracks.forEach((jtrack, index) =>
                find_track_with_the_best_bitrate_and_download_it(jtrack, true, index * 4000));
        });
}


function get_bitrate(info) {

    return new Promise((resolve, reject) => {

        Request({
            url: "https://vk.com/al_audio.php",
            headers: {
                Host: "vk.com",
                Cookie: info["remixsid"]
            },
            content: {
                act: 'reload_audio',
                ids: info["id"] + "," + info["id"],
                al: "1"
            },
            onComplete: response => {
                let content = response.text;
                let jstr = content.substring(content.indexOf("[["),
                    content.indexOf("]]<!>") + 2);
                let parsed = "";
                try {
                    parsed = JSON.parse(jstr);
                } catch (err) {
                    console.log("from get_bitrate " + err.name + "\n" + content + " " + info["id"] + " " + info["remixsid"]);
                    return;
                }

                let url = parsed[0][2];
                let duration = parsed[0][5];

                Request({
                    url: url,
                    onComplete: response => {
                        let size = response.headers['Content-Length']; //get file size
                        let kbit = size / 128; //calculate bytes to kbit
                        let bitrate = Math.ceil(Math.round(kbit / duration) / 16) * 16;
                        if (bitrate > 320)
                            bitrate = 320;

                        size = size / 1024 / 1024;
                        if (preferences["show_bitrate"] == "bitrate_size") {
                            info["bitrate"] = bitrate + "kbs | " + size.toFixed(1) + 'mb';
                        } else {
                            info["bitrate"] = bitrate;
                        }

                        resolve(info);
                    }
                }).head();
            }
        }).post();
    });
}


function get_jtracks_bitrate(jtrack) {

    return new Promise((resolve, reject) => {

        let bitrates = [];
        for (let c = 0; c < jtrack["vk_stuff"].length; c++) {

            setTimeout(() => {
                get_bitrate(jtrack["vk_stuff"][c])
                    .then(info => {
                        bitrates.push(info);
                        if (bitrates.length == jtrack["vk_stuff"].length) {

                            bitrates.sort((x, y) => {
                                return x["bitrate"] - y["bitrate"]
                            });
                            bitrates.sort(i => {
                                if (i["bitrate"] == 320)
                                    return -1;
                            });

                            jtrack["id"] = bitrates[0]["id"];
                            resolve(jtrack);
                        }

                    });
            }, (c + 1) * 5000);
        }
    });
}



function find_track(jtrack, section, vk_stuff = []) {

    return new Promise((resolve, reject) => {

        if (vk_stuff.length > 4)
            resolve(vk_stuff);

        setTimeout(() => {

            let query = jtrack["artist"] + " " + jtrack["title"];
            Request({
                url: "https://vk.com/al_search.php",
                headers: {
                    Host: "vk.com",
                    Cookie: jtrack["remixsid"],
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64; rv:47.0) Gecko/20100101 Firefox/47.0"
                },
                content: {
                    ads_section: 'search',
                    ads_showed: "",
                    al: "1",
                    al_ad: "1",
                    "c[q]": query,
                    "c[section]": section,
                    change: "1"
                },

                onComplete: response => {

                    let content = response.text;
                    let htmlString = content.substring(content.indexOf("<div"));
                    let doc = parser.parseFromString(htmlString, "text/html");
                    let res = doc.getElementsByClassName("audio_row");

                    for (let e of res) {
                        if (e.className.includes("claimed"))
                            continue;
                        let id = e.getAttribute("data-full-id").trim();
                        let duration = e.getElementsByClassName("audio_duration")[0].innerText.trim();
                        let title = e.getElementsByClassName("audio_title_inner")[0].getAttribute("aria-label").trim();

                        if (!compare_durations(jtrack["duration"], duration) || !compare_tracks_titles(title, jtrack["title"])) {
                            continue;
                        }

                        vk_stuff.push({
                            "id": id,
                            "duration": duration,
                            "remixsid": jtrack["remixsid"]
                        });
                    }

                    jtrack["vk_stuff"] = vk_stuff.slice(0, 4);
                    resolve(jtrack);
                }
            }).post();

        }, jtrack["timeout"]);
    });
}




function download_all_user_tracks(user_id, remixsid) {

    let dir = make_download_path("group", true);

    Request({
        url: "https://vk.com/al_audio.php",
        headers: {
            Host: "vk.com",
            Cookie: remixsid
        },
        content: {
            act: 'load_silent',
            owner_id: user_id,
            al: "1",
            band: "false",
            album_id: "-2"
        },
        onComplete: response => {
            let content = response.text;
            let jstr = content.substring(content.indexOf("[["),
                content.indexOf("]]") + 2);

            try {
                let parsed = JSON.parse(jstr);
                parsed.forEach((item, index) => {

                    setTimeout(() => {
                        prepare_to_download_track({
                            artist: item[4],
                            title: item[3],
                            remixsid: remixsid,
                            dir: dir,
                            id: item[1] + "_" + item[0]
                        }, false);
                    }, index * 3000);
                });
            } catch (err) {
                console.log("ERROR " + err.name + " " + err.message);
                return;
            }
        }
    }).post();
}

function is_path_existed(path) {
    try {
        if (io.exists(path) && !io.isFile(path))
            return true;
        io.mkpath(path);
        return true;
    } catch (e) {
        return false;
    }
}


function spotify(tracks) {

    return new Promise((resolve, reject) => {
        try {

            spotify_get_albums_ids(tracks.slice(0, 4))
                .then(results => {

                    if (results.length == 0) {
                        resolve(null);
                        return;
                    }

                    let set_albums_ids = new Set(...results);

                    spotify_get_album_info(set_albums_ids)
                        .then(results => {


                            results = results.filter(i => i.tracks.total >= tracks.length);
                            if (results.length == 0) {
                                resolve(null);
                                return;
                            }


                            try {
                                results.sort((x, y) => {
                                    if (x.tracks.total > y.tracks.total)
                                        return -1;
                                });

                                for (let album_info of results) {
                                    let is_release_relevant = tracks.every(track => {
                                        return album_info.tracks.items.some(jtrack => {
                                            return compare_tracks_titles(track["title"], jtrack["name"]);
                                        });
                                    });

                                    if (is_release_relevant) {
                                        resolve({
                                            album_title: album_info.name,
                                            artist: album_info.artists[0].name.replace(/\*$/, "").trim(),
                                            cover: album_info.images[0].url,
                                            items: fill_info_to_tracks(album_info)
                                        });
                                        return;
                                    }
                                }
                                resolve(null);
                            } catch (e) {
                                console.log(e.name + e.message);
                            }
                        });
                });

        } catch (e) {
            console.log(e.name + e.message);
        }
    });
}


function fill_info_to_tracks(album_info) {

    try {
        let modern_tracks = [];
        let album_title = album_info.name;
        let album_year = album_info.release_date.split("-")[0];

        for (let spotify_track of album_info.tracks.items) {
            modern_tracks.push({
                title: spotify_track.name,
                position: spotify_track.track_number,
                year: album_year,
                album_title: album_title,
                artist: album_info.artists[0].name,
                artists: spotify_track.artists.map(artist => artist.name),
                duration: spotify_track.duration_ms
            });
        }

        return modern_tracks;
    } catch (e) {
        console.log(e.name + e.message);
    }
}



function spotify_get_albums_ids(tracks) {

    let promises = [];

    for (let track of tracks) {

        promises.push(
            new Promise((resolve, reject) => {

                Request({
                    url: `https://api.spotify.com/v1/search?q=${track["artist"]} ${track["title"]}&type=track`,
                    headers: {
                        "Accept": "application/json"
                    },
                    onComplete: response => {
                        let jstr = JSON.parse(response.text);
                        let albums_ids = [];

                        for (let item of jstr.tracks.items) {
                            albums_ids.push(item.album.uri.split(":")[2]);
                        }
                        resolve(albums_ids);
                    }
                }).get();

            })
        );
    }

    return Promise.all(promises);
}



function spotify_get_album_info(albums_ids) {

    try {
        let promises = [];

        for (let album_id of albums_ids) {
            promises.push(
                new Promise((resolve, reject) => {

                    Request({
                        url: `https://api.spotify.com/v1/albums/${album_id}`,
                        headers: {
                            "Accept": "application/json"
                        },
                        onComplete: response => {
                            let album_info = JSON.parse(response.text);
                            resolve(album_info);
                        }
                    }).get();
                })
            );
        }
        return Promise.all(promises);
    } catch (e) {
        console.log(e.name + e.message);
    }
}

function discogs(tracks) {

    return new Promise((resolve, reject) => {

        let key = "tXAbsRwceFgjPfvdCOeO";
        let secret = "bthDUNSczEhdXikFOXXcaEdklCiHOCrH";

        let old_tracks = JSON.parse(JSON.stringify(tracks));
        tracks = tracks.slice(0, 4);
        let string_tracks = tracks.map(i => i["title"]).join(" ");

        try {
            Request({

                url: `https://api.discogs.com/database/search?type=release&track=${string_tracks}&key=${key}&secret=${secret}`,
                onComplete: response => {

                    let jstr = JSON.parse(response.text);

                    if (!jstr["results"]) {
                        resolve(null);
                        return;
                    }

                    let releases = discogs_release_filter(jstr["results"]);

                    if (!releases.length) {
                        resolve(null);
                        return;
                    }


                    let releases_promises = [];

                    for (let release of releases) {
                        releases_promises.push(new Promise((resolve, reject) => {
                            Request({
                                url: release["resource_url"],
                                onComplete: response => {

                                    let jresp = JSON.parse(response.text);
                                    let jplaylist = jresp["tracklist"];

                                    if (!jplaylist)
                                        return;

                                    let is_release_relevant = old_tracks.every(track => {
                                        return jplaylist.some(jtrack => {
                                            return compare_tracks_titles(track["title"], jtrack["title"]);
                                        });
                                    });

                                    if (is_release_relevant) {
                                        jplaylist["artist"] = release["title"].split(" - ")[0].replace(/\(\d+\)/g, "").trim();
                                        jplaylist["album_title"] = release["title"].split(" - ").slice(1).join().trim();
                                        jplaylist["id"] = release["id"];
                                        jplaylist["year"] = release["year"];

                                        for (let jtrack of jplaylist) {
                                            if (jtrack.hasOwnProperty("artists")) {
                                                let artist_array = jtrack["artists"]
                                                    .map(jname => jname["name"]
                                                        .replace(/\(\d+\)$/, "").trim()
                                                        .replace(/\*$/, "").trim());
                                                jtrack["artists"] = artist_array;
                                            } else {
                                                jtrack["artists"] = [jplaylist["artist"]];
                                            }
                                            jtrack["year"] = release["year"];
                                            jtrack["artist"] = jplaylist["artist"];
                                            jtrack["album_title"] = jplaylist["album_title"].replace(/\*$/, "").trim();
                                        }

                                        resolve({
                                            artist: jplaylist["artist"],
                                            album_title: jplaylist["album_title"].replace(/\*$/, "").trim(),
                                            cover: jplaylist["id"],
                                            items: jplaylist
                                        });

                                    } else {
                                        resolve(null);
                                    }
                                }
                            }).get();
                        }));
                    }
                    Promise.all(releases_promises)
                        .then(result => {
                            result.sort();
                            resolve(result[0]);
                        });

                }

            }).get();
        } catch (e) {
            console.log(e.name + e.message);
        }
    });
}


function discogs_release_filter(releases) {
    let unwanted_formats = ["Single", "Multi-Single", "Vinyl", "CD-ROM", "DVD", "NTSC", "Cassette"];
    let filtrated_releases = [];

    for (let release of releases) {
        let unwanted_format_includes = release["format"].some(elem => unwanted_formats.includes(elem));
        if (!unwanted_format_includes)
            filtrated_releases.push(release);
    }

    filtrated_releases.sort(release => {

        if (["US", "UK"].includes(release["country"]))
            return -1;

    });


    filtrated_releases.sort(release => {
        for (let format of release["format"]) {
            if (format.toLowerCase().includes("deluxe") || format.toLowerCase().includes("limited"))
                return -1;
        }
    });

    return filtrated_releases;
}


function get_cover(cover, dir) {

    if (typeof cover != "number") {
        download_track(cover, dir, "cover.jpg");
    } else {

        let key = "tXAbsRwceFgjPfvdCOeO";
        let secret = "bthDUNSczEhdXikFOXXcaEdklCiHOCrH";

        Request({
            url: `https://api.discogs.com/releases/${cover}`,
            headers: {
                "Authorization": `Discogs key=${key}, secret=${secret}`
            },
            onComplete: response => {

                let jresp = JSON.parse(response.text);

                if (!jresp.hasOwnProperty("images"))
                    return;

                let images = jresp["images"];

                images.sort(image => {
                    if (image["type"] == "primary")
                        return -1;
                });

                for (let image of images) {
                    download_track(image["uri"], dir, "cover.jpg");
                    break;
                }
            }
        }).get();
    }
}



function get_bitrates(info) {

    return new Promise((resolve, reject) => {

        Request({
            url: "https://vk.com/al_audio.php",
            headers: {
                Host: "vk.com",
                Cookie: info["remixsid"]
            },
            content: {
                act: 'reload_audio',
                ids: info['ids'],
                al: "1"
            },
            onComplete: response => {
                let promises = [];
                let content = response.text;
                let jstr = content.substring(content.indexOf("[["),
                    content.indexOf("]]<!>") + 2);
                let parsed = "";

                try {
                    parsed = JSON.parse(jstr);
                } catch (err) {
                    console.log(err.name + " " + err.message);
                    reject();
                }

                for (let i of parsed) {
                    promises.push(
                        new Promise((resolve, reject) => {
                            let url = i[2];
                            let duration = i[5];
                            let id = i[1] + "_" + i[0];
                            Request({
                                url: url,
                                onComplete: response => {
                                    let size = response.headers['Content-Length']; //get file size
                                    let kbit = size / 128; //calculate bytes to kbit
                                    let bitrate = Math.ceil(Math.round(kbit / duration) / 16) * 16;
                                    if (bitrate > 320)
                                        bitrate = 320;

                                    resolve({
                                        id: id,
                                        bitrate: bitrate
                                    });
                                }
                            }).head();
                        })
                    );
                }

                Promise.all(promises)
                    .then(result => {
                        resolve(result);
                    });
            }
        }).post();
    });
}



function compare_tracks_titles(vk_track_title, spotyfy_track_title) {

    vk_track_title = vk_track_title.replace(/ё/g, "е").toLowerCase();;
    spotyfy_track_title = spotyfy_track_title.replace(/ё/g, "е").toLowerCase();
    let split_vk_track_title = vk_track_title.replace(/([\(\)\&\-\.])|feat|ft\./g, " ").split(" ");
    let split_spotyfy_track_title = spotyfy_track_title.replace(/([\(\)\&\-\.])|feat|ft\./g, " ").split(" ");

    if (split_vk_track_title.length != split_spotyfy_track_title.length)
        return false;

    return split_vk_track_title.every(word => spotyfy_track_title.includes(word));

}