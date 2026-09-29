# gryt-helper

A small program that holds Discord's Rich Presence socket for Gryt. It starts at login, but only once somebody turns it on in Settings. Starting before Discord means games report to Gryt more often.

## What it does

- Takes `discord-ipc-0` when nobody else has it. If something does, it takes the next free slot up to `discord-ipc-9`, and moves down to 0 once whatever had it quits.
- Never removes, replaces or connects to a socket or pipe another program holds. On macOS it asks `lsof` who's listening, and on Linux it reads `/proc/net/unix`. A leftover file nobody listens on is removed only if it's a socket we own. On Windows, a pipe's first instance can't be shared, so the helper tries to create it and backs off if that fails.
- Answers games the same way `electron/discordIpc.ts` does, and keeps the latest activity from each one.
- Passes that to the Gryt app over a private socket only the same user can open:
  - macOS: `~/Library/Application Support/chat.gryt.helper/helper.sock`
  - Linux: `$XDG_RUNTIME_DIR/gryt-helper/helper.sock`, or `~/.cache/gryt-helper/` without it
  - Windows: `\\.\pipe\gryt-helper-<hash of the account name>`, readable only by that account and SYSTEM

## The private channel

One JSON object per line. The helper sends:

```json
{"type":"hello","version":1,"pid":123,"state":"holding","slot":0}
{"type":"state","state":"yielded","slot":null}
{"type":"activity","connection":4,"clientId":"1234","pid":42,"activity":{"details":"Ranked"}}
```

An `activity` of `null` means that game cleared it or went away. When an app connects, it gets the hello and every activity that's showing. The only thing an app can send is `{"type":"quit"}`, which stops the helper and removes its socket.

## Building and testing

```bash
node scripts/build-helper.mjs          # helper/dist/gryt-helper for this machine
cd helper && go test ./...
```

It needs Go 1.22, the same version the release workflow uses for the SFU.
