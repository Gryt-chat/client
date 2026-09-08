/*
 * Presence — the client half. Sets your own status line (needs `status`), and
 * mirrors it to any server running the server half (needs `messaging`, `display`).
 */

/** Where to ask what you are playing. Change this to your own. */
const SOURCE = "http://127.0.0.1:7331/";

/** How often to ask. Under a second and you are hammering your own machine. */
const POLL_MS = 15_000;

/** Bump this if you change what the two halves say to each other. */
const PROTOCOL = 1;

/**
 * Ask the source what you are playing. Returns null for anything that is not a
 * game name, the source not running included — which is the normal case.
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
   * Hosts we have already introduced ourselves to. A server that has never heard
   * from us needs a hello, or joining mid-session leaves you off the roster.
   */
  const greeted = new Set();

  /*
   * Who is playing what, per server, so a panel can show all of them at once.
   * `roster` arrives per host and replaces that host's part of the list.
   */
  const rosters = new Map();

  function draw() {
    const rows = [];
    for (const [host, entries] of rosters) {
      for (const entry of entries) {
        // The host in the value, so somebody on two servers can tell them
        // apart. Dropped when there is only one, because then it says nothing.
        rows.push({
          label: entry.who,
          value: rosters.size > 1 ? `${entry.game} · ${host}` : entry.game,
        });
      }
    }

    // Nothing to say, so take the panel down rather than leave an empty one.
    if (rows.length === 0) return gryt.ui.clear();

    return gryt.ui.panel({ title: "Playing now", rows });
  }

  gryt.messaging.on("roster", ({ host, data }) => {
    // This came from your own server half, which built it out of other
    // people's messages. Check it anyway.
    if (!Array.isArray(data)) return;

    const entries = [];
    for (const entry of data) {
      if (typeof entry?.who !== "string" || typeof entry?.game !== "string") continue;
      entries.push({ who: entry.who, game: entry.game });
    }

    rosters.set(host, entries);
    void draw();
  });

  async function sync(changed) {
    const hosts = await gryt.messaging.servers();

    // A server we were on and no longer are gets introduced to again if we come
    // back. Its roster goes with it: leaving should not leave its people here.
    for (const host of [...greeted]) {
      if (hosts.includes(host)) continue;
      greeted.delete(host);
      if (rosters.delete(host)) void draw();
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

      // Thirty messages per ten seconds is the limit, and a poll loop is how you
      // find it — so this sends on a change or a new server, not every tick.
      await sync(changed);
    } catch (error) {
      gryt.log.error(`presence: ${error.message}`);
    }

    if (!stopped) timer = setTimeout(tick, POLL_MS);
  }

  gryt.on("cleanup", () => {
    stopped = true;
    if (timer) clearTimeout(timer);

    // Turning the plugin off should take the status line and the panel with it,
    // otherwise you are Factorio forever.
    void gryt.setActivity("");
    void gryt.ui.clear();
  });

  void tick();
}
