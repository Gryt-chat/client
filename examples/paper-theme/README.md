# Paper

A light theme with a warmer background and a rust accent. Forty lines of CSS,
and a good place to start if you want your own.

## Install it

Settings → Addons → **Open folder**, drop `paper-theme` in, turn it on. Pick the
light appearance in Settings, since this only overrides the light one.

## How a theme works

`manifest.json` says `"type": "theme"` and lists `styles`. Gryt appends those
files to the page after its own stylesheet.

Everything Gryt draws is built out of a handful of variables, so setting those
is all a theme normally does:

| | |
| --- | --- |
| `--color-background` | behind everything |
| `--color-panel-solid` | channel list, member list, composer |
| `--color-panel-translucent` | the same panel where Gryt sees through it |
| `--color-surface` | inputs and cards sitting on a panel |
| `--color-overlay` | dims the page behind a modal |
| `--gryt-accent-9` | buttons, links, the unread dot |
| `--code-font-family` | code blocks |

They're defined in [`src/style.css`](../../src/style.css) under `.light` and
`.dark`, which is where to look for the current values.

## Two things that will bite

**Keep the alpha on the translucent one.** A solid colour there makes menus look
like they're floating on nothing.

**Don't reach for class names.** They're generated and they change. A theme
built on variables survives an update. One built on `.css-1x7f9a` breaks the
first time somebody renames a component.
