/*
 * What you are playing, over HTTP, so the plugin has something to ask. Nothing
 * here is Gryt — swap it for whatever you actually have.
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
