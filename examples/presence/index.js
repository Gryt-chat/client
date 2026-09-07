/*
 * Presence — the client half.
 *
 * Two jobs, and they are worth keeping apart in your head:
 *
 *   1. Sets your own status line, which everybody already sees in the member
 *      list. This needs `status` and no server plugin at all.
 *   2. Sends the same thing to any server running the server half, which fans
 *      it out to everybody else's copy of this plugin. This needs `messaging`
 *      on both ends.
 *
 * The second one is the pair. The first one works on its own, so if you only
 * want your own status line, delete the messaging half and drop `messaging`
 * from the manifest.
 *
 * Where the game name comes from: a plugin runs in a worker and cannot see
 * your processes, so something outside has to tell it. This one asks a small
 * HTTP endpoint on your own machine. `source.mjs` next to this file is one you
 * can run; anything that answers with JSON will do.
 */

/** Where to ask what you are playing. Change this to your own. */
const SOURCE = "http://127.0.0.1:7331/";

/** How often to ask. Under a second and you are hammering your own machine. */
const POLL_MS = 15_000;

/** Bump this if you change what the two halves say to each other. */
const PROTOCOL = 1;

/**
 * Ask the source what you are playing.
 *
 * Returns null for anything that is not a game name, including the source not
 * running — which is the normal case when you have not started it, so it is a
 * quiet return rather than an error.
 */
async function readGame() {
  try {
    const response = await fetch(SOURCE, { cache: "no-store" });
    if (!response.ok) return null;

    const body = await response.json();
    const game = typeof body?.game === "string" ? body.game.trim() : "";

    // 80 is arbitrary. The point is that this string ends up in front of other
    // people and the source is a file you edit at 2am.
    return game ? game.slice(0, 80) : null;
  } catch {
    return null;
  }
}

export function activate() {
  let game = null;
  let timer = null;
  let stopped = false;

  /*
   * Hosts we have already introduced ourselves to.
   *
   * A server that has never heard from us needs the current game and a hello,
   * whether or not the game changed — otherwise joining a server mid-session,
   * or coming back after the wifi dropped, leaves you off everybody's roster
   * until you next quit a game.
   */
  const greeted = new Set();

  gryt.messaging.on("roster", ({ host, data }) => {
    // This came from your own server half, which built it out of other
    // people's messages. Check it anyway.
    if (!Array.isArray(data)) return;

    for (const entry of data) {
      if (typeof entry?.who !== "string" || typeof entry?.game !== "string") continue;
      gryt.log.info(`[${host}] ${entry.who} is playing ${entry.game}`);
    }
  });

  async function sync(changed) {
    const hosts = await gryt.messaging.servers();

    // A server we were on and no longer are gets introduced to again if we
    // come back, which is what makes a reconnect work.
    for (const host of [...greeted]) {
      if (!hosts.includes(host)) greeted.delete(host);
    }

    for (const host of hosts) {
      const isNew = !greeted.has(host);
      if (!isNew && !changed) continue;

      // Ask for the roster before saying anything, so the reply and our own
      // update do not race into the same log line out of order.
      if (isNew) {
        greeted.add(host);
        await gryt.messaging.send("hello", { v: PROTOCOL }, host);
      }

      await gryt.messaging.send("playing", { v: PROTOCOL, game }, host);
    }
  }

  async function tick() {
    const current = await readGame();
    const changed = current !== game;
    game = current;

    try {
      // Your own status line, which needs no server plugin. Empty clears it.
      if (changed) await gryt.setActivity(game ? `🎮 ${game}` : "");

      // Thirty messages per ten seconds is the limit, and a poll loop is
      // exactly how you find it — so this sends on a change or a new server,
      // not on every tick.
      await sync(changed);
    } catch (error) {
      gryt.log.error(`presence: ${error.message}`);
    }

    if (!stopped) timer = setTimeout(tick, POLL_MS);
  }

  gryt.on("cleanup", () => {
    stopped = true;
    if (timer) clearTimeout(timer);

    // Turning the plugin off should take the status line with it, otherwise
    // you are Factorio forever.
    void gryt.setActivity("");
  });

  void tick();
}
