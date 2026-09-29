#!/usr/bin/env node
/** Reading what's playing from each OS's media controls (GRYT-1637). Only a playing track counts. */

import assert from "node:assert/strict";

import { parseMac, parseMprisNames, parseMprisPlayer, parseWindows, playerKey } from "../electron/nowPlaying.ts";

let failures = 0;
function check(name, run) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.stack ?? err.message}`);
  }
}

console.log("now playing");

check("a player's many names become one key", () => {
  assert.equal(playerKey("Spotify.exe"), "app:spotify");
  assert.equal(playerKey("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), "app:spotify");
  assert.equal(playerKey("org.mpris.MediaPlayer2.spotify"), "app:spotify");
  assert.equal(playerKey("org.mpris.MediaPlayer2.firefox.instance_1_42"), "app:firefox");
  assert.equal(playerKey("org.mpris.MediaPlayer2.chromium.instance1234"), "app:chrome");
});

check("Windows: a playing session becomes a track, anything else nothing", () => {
  const playing = parseWindows('{"app":"Spotify.exe","title":"Harbour Lights","artist":"Tove","album":"Waves","status":"Playing"}');
  assert.deepEqual(playing, { key: "app:spotify", player: "Spotify", title: "Harbour Lights", artist: "Tove", album: "Waves" });
  assert.equal(parseWindows('{"app":"Spotify.exe","title":"x","status":"Paused"}'), null);
  assert.equal(parseWindows(""), null);
  assert.equal(parseWindows("not json"), null);
});

const GETALL = "({'PlaybackStatus': <'Playing'>, 'Metadata': <{'xesam:title': <'Harbour Lights'>, 'xesam:artist': <['Tove']>, 'xesam:album': <'Waves'>}>},)";

check("Linux: MPRIS names and a playing player's track", () => {
  assert.deepEqual(parseMprisNames("(['org.freedesktop.DBus', 'org.mpris.MediaPlayer2.spotify', ':1.4'],)"), ["org.mpris.MediaPlayer2.spotify"]);
  assert.deepEqual(parseMprisPlayer("org.mpris.MediaPlayer2.spotify", GETALL), { key: "app:spotify", player: "Spotify", title: "Harbour Lights", artist: "Tove", album: "Waves" });
  assert.equal(parseMprisPlayer("org.mpris.MediaPlayer2.spotify", GETALL.replace("Playing", "Paused")), null);
});

check("macOS: the osascript line, or nothing when nothing plays", () => {
  assert.deepEqual(parseMac("app:music", "Harbour Lights\u001fTove\u001fWaves\n"), { key: "app:music", player: "Apple Music", title: "Harbour Lights", artist: "Tove", album: "Waves" });
  assert.equal(parseMac("app:music", "\n"), null);
});

console.log(failures === 0 ? "\nnow playing: ok" : `\nnow playing: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
