# Addon examples

Two addons you can copy and change.

| | What it is | Asks for |
| --- | --- | --- |
| [`paper-theme`](paper-theme) | A warmer light theme. CSS, nothing else. | nothing |
| [`presence`](presence) | Puts what you're playing under your name, and draws who else is playing what | `status`, `messaging`, `display` |

`presence` is half of a pair. The server half is in the server repo, under
[`examples/presence`](https://github.com/Gryt-chat/server/tree/main/examples/presence).
The status line works without it — the roster of everybody else doesn't.

## Installing one

Open **Settings → Addons → Open folder**, drop the folder in, and Gryt picks it
up. No restart.

A plugin then needs its switches turned on, under the addon. Until you do that,
the calls it makes are refused and it's told why.

## The difference between the two

A theme is CSS. It can't call anything, so the worst a bad one does is look
wrong.

A plugin is JavaScript, and Gryt runs it in a worker of its own. It can reach
the `gryt` API for what you granted, and the internet, and nothing else. Not the
page, not your messages, not your identity key. What you granted is what it
gets.

It can still be seen. A plugin sends Gryt a title and rows of text and Gryt
draws them beside the member list — never markup, never an element it hands
over. `presence` is the one that does this.

The internet is the hole in that. What a plugin is given it can send anywhere,
so letting one read your messages is trusting whoever wrote it with those
messages wherever they end up.

## Writing your own

[Addons](https://docs.gryt.chat/docs/build/addons) covers the manifest, the
API and the capabilities. [Plugin
pairs](https://docs.gryt.chat/docs/build/plugin-pairs) covers the two halves.
