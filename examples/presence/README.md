# Presence — the client half

Sets your status line to what you're playing, so it shows under your name in
the member list. And sends the same thing to any server running the other half,
which passes it on to everybody else with this plugin.

The status line works on its own. The roster is the part that needs the other
half.

## Where the game name comes from

Not from your machine. A plugin runs in a worker with no view of your
processes, so it can't tell what you have open — [the addons
page](https://docs.gryt.chat/docs/client/addons) says why, and it's a real
thing Gryt doesn't do rather than something this example skipped.

So something outside has to say. This one asks an HTTP endpoint on your own
machine for `{ "game": "..." }`, and `source.mjs` is one you can run:

```bash
node source.mjs "Deep Rock Galactic"
```

That's twenty lines of Node and none of it is Gryt. Swap it for whatever you
actually have — a script that reads a window title, your music player's API, a
file you edit by hand. When nothing answers, the plugin clears your status and
stays quiet.

## Install it

Settings → Addons → **Open folder**, drop `presence` in, then turn on both
switches under it:

- **Set what you are doing, on every server you are on** — the status line
- **Exchange its own messages with the servers you are on** — the roster

Turn on only the first and the status line still works. The plugin logs an
error about the second and carries on.

## The server half

In the server repo, under
[`examples/presence`](https://github.com/Gryt-chat/server/tree/main/examples/presence).
Whoever runs the server installs it. You can check whether they have: the
server menu lists what a server runs, under **What this server runs**, and Gryt
tells you when a plugin there has a half you don't have.

Without it, `gryt.messaging.servers()` comes back empty and the plugin sends
nothing. That's the normal case — most servers won't have your plugin — so it's
cheap rather than an error.

## What the two halves say

Three topics, made up by this plugin. Gryt carries `{ topic, data }` and stays
out of the rest.

| Topic | Direction | Data |
| --- | --- | --- |
| `hello` | client → server | `{ v: 1 }` — I just got here, what's the roster |
| `playing` | client → server | `{ v: 1, game: "Factorio" }`, or `game: null` to come off |
| `roster` | server → clients | `[{ who, game }, …]` |

The `v` is there because the server doesn't say which version it's running, on
purpose. If your halves need to agree on something, agree on it in your own
payloads.

## Where the roster goes

`gryt.log.info`, which is the console and nothing else. A plugin can't draw —
it isn't on the page — so there's nowhere else to put it yet.

## Two things that will bite

**Send on a change, not on a tick.** Thirty messages per ten seconds is the
limit, per person per plugin, and a poll loop is exactly how you find it. This
one holds the last game and only sends when it moves.

**A new server needs telling.** Joining one mid-session, or coming back after
the wifi dropped, gives you a server that has never heard from you and won't
until you next quit a game. `sync` tracks which hosts it has greeted and says
hello to the ones it hasn't.
