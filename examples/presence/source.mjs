/*
 * What you are playing, over HTTP, so the plugin has something to ask.
 *
 * node source.mjs
 * node source.mjs "Deep Rock Galactic"
 *
 * Nothing here is Gryt. This exists because a plugin runs in a worker and
 * cannot read your processes, so the game name has to come from outside. Swap
 * it for whatever you actually have: a script that reads a window title, your
 * music player's API, a file you edit by hand.
 */

import { createServer } from "node:http";

const PORT = 7331;
const game = process.argv[2] ?? "Factorio";

createServer((request, response) => {
  // The plugin runs inside Gryt, so this is a cross-origin request and needs
  // to say so. Localhost only, so `*` is not much of a decision.
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ game }));
}).listen(PORT, "127.0.0.1", () => {
  console.log(`playing "${game}" on http://127.0.0.1:${PORT}/`);
});
