# End-to-end tests

These run the web client in headless Chromium against a real Gryt server. Each worker
gets its own server, started from the published Docker image. CI runs them as the `e2e`
job in `.github/workflows/ci.yml` on pull requests that can change the web client. A pull
request that only touches `docs/`, Markdown, `electron/`, `build/`, `appimagehub/`, the
electron-builder config or `scripts/check-*.mjs` skips the job.

## Running them

You need Docker running and the client's dependencies installed. Install the browser once
per Playwright version:

```bash
yarn playwright install chromium --only-shell
```

Then:

```bash
yarn e2e                                                        # builds, then runs everything
yarn playwright test --config e2e/playwright.config.ts dm.spec  # one file, with the last build
```

Each worker starts `ghcr.io/gryt-chat/server:latest` in its own container, on ports Docker
picks. That server takes guests, lets anyone join and keeps its database and uploads inside
the container. The container goes when the worker stops, so every run starts empty.
`docker pull ghcr.io/gryt-chat/server:latest` gets you a newer server, and
`GRYT_E2E_SERVER_IMAGE` runs another tag or an image you built.

When a test fails, `e2e/test-results` gets its trace, screenshots, video and the server's
log. Open the report with:

```bash
yarn playwright show-report e2e/playwright-report
```

CI uploads both folders as the `e2e-report` artifact when the job fails.

### Against a server you started

```bash
GRYT_E2E_SERVER=127.0.0.1:5003 GRYT_E2E_APP_PORT=4666 yarn e2e
```

The server has to be fresh. Whoever joins a server first owns it, and the owner tests need
that to be the suite's own guest. Start it with `GRYT_IDENTITY_TIERS=local` and
`CORS_ORIGIN=http://127.0.0.1:4666`, and open it to joins. If you set `GRYT_E2E_ADMIN_URL`
and `GRYT_E2E_ADMIN_TOKEN` to its management API, the suite opens it for you. This mode
runs one worker. It skips the phone settings test, which needs a server of its own.

## Writing a test

Import `test` and `expect` from `support/fixtures`, not from `@playwright/test`. That gets
you:

- `newMember()`: A new browser context that joins the worker's server as a guest, with its
  own identity and a unique nickname. It has already agreed to the terms, so its first
  message doesn't ask. Pass `{ phone: true }` for a 390x844 touch screen, `{ join: false }`
  to stop at the empty app, or `{ agreed: false }` for one that hasn't agreed yet.
- `owner`: A page for the guest that joined first and owns the server.
- `gryt.server`: The server's `host` and `httpBase`.
- `freshServer()`: Another server, for a test that has to own one from a phone. Pass
  `{ instanceId }` for a server whose /info gives an id. It listens on the same port inside
  the container and out, like a server you host.

`support/app.ts` has helpers for joining, sending a message and finding its row. When a
second test needs a helper, move it there.

## Rules

- **No fixed sleeps.** Wait for something on the page, a request or a response. Don't use
  `waitForTimeout`.
- **No live sites.** Anything that leaves the machine goes through `support/external.ts`,
  which answers with fixtures. A request without a fixture fails the test and names the
  URL. What's new reads `fixtures/changelog.json`.
- **Console errors fail the test.** So do uncaught exceptions, and a 429 or 5xx from the
  test server. If an error is known and harmless, add it to the allowlist in
  `support/problems.ts` with a comment saying why.
- **Tests share a server** with the rest of their worker. Make message text unique with
  `unique()`, and look for your own rows instead of counting.
- **Don't work around a real bug on main.** Open a task, and mark the test
  `test.fixme("GRYT-123: …")` until it's fixed.

CI retries a failed test once. One that only passes on the retry shows up as flaky in the
report.

## Nightly

`e2e/nightly` covers what a throwaway server can't: a call through a real SFU on a public
address, screen share, and the desktop app hosting a server. `.github/workflows/nightly.yml`
runs it at 03:17 UTC, when somebody starts it by hand, and on pull requests that change the
suite. It uses the same helpers as the suite above.

- **The call** (`voice.spec.ts`, `screen-share.spec.ts`). Two guests join `test.gryt.chat`
  with the invite and go into Voice Chat, with Chrome's fake microphone, camera and screen.
  The tests read `getStats` in each page. Audio keeps arriving on both sides, the candidate
  pair ICE picked ends at an address the SFU offered and not a private one, and the other
  guest decodes frames from the camera and from the shared screen.
- **The desktop app** (`electron.spec.ts`). It starts the app with a user data directory of
  its own and creates a server from Add a server. The rail has to offer Manage server for it.
  The test holds the SFU's default registration and metrics ports first, like a second app
  on the machine would. Then one process under the app has to hold the SFU's signalling,
  registration, metrics and media ports, with registration on 127.0.0.1 only. A browser
  joins last, with an invite made in the app.

Every guest leaves the call and then the server when its test ends, so `test.gryt.chat`
doesn't gain a member each night. The "joined" and "left" lines in General stay, because a
guest can't delete them.

### The server

`test.gryt.chat` is described in `ops/deploy/compose/TEST.md` in the superproject. CI has its
address and invite as the `GRYT_TEST_SERVER_URL` and `GRYT_TEST_INVITE_CODE` secrets. Its
CORS list names origins one by one, so the suite serves the client on `127.0.0.1:4173`,
which is on it.

### Running it by hand

```bash
yarn vite build
GRYT_TEST_SERVER_URL=https://test.gryt.chat GRYT_TEST_INVITE_CODE=… \
  yarn playwright test --config e2e/nightly/playwright.config.ts --project call
```

Off CI the browser keeps its own ICE candidates from the SFU. On the same network as the
test server, the call would otherwise go straight over the LAN and fail the address check.
`GRYT_E2E_SEND_LOCAL_CANDIDATES=1` sends them anyway. A server on this machine or the LAN
works too, and then the check only asks for an address the SFU offered.

The desktop app test needs `yarn build:embedded-server` and `ELECTRON=1 yarn vite build`
first. The build script looks for the server, SFU and image worker beside the client or in
the superproject. CI runs it on Linux under `xvfb-run`. It skips itself on macOS, where the
app asks for camera access every time it starts until Electron has an answer in System
Settings. Set `GRYT_E2E_ELECTRON_ON_MAC=1` once it does.

## Soak

`e2e/soak` keeps a call up for hours and logs everything on the way, so a drop can be put on
the path or on Gryt. It isn't a test and CI doesn't run it. GRYT-1325 was the first run.

Clients come in up to three groups, one for each way of reaching a server:

- `tunnel`: `test.gryt.chat` through Cloudflare, with media going to the SFU's public address.
- `direct`: the same server on the LAN. The page swaps the SFU's public address for its LAN
  one before the WebSocket opens, so these calls skip the tunnel too.
- `local`: a server on this machine that anyone can join, if you start one.

Each group gets call clients and probes. A call client is a Chromium of its own. It joins
with the invite and sits in Voice Chat with the fake camera on. The probes need no invite.
There's a bare socket.io connection and a raw WebSocket to the SFU from Node, the same two
from one Chromium page, and a `GET /health` every 10 seconds. On top of that there's `ping`
to anything you list, and a look at this machine's addresses every 5 seconds. Those are
hashed, so the files don't carry them.

Every client and probe writes its own JSONL file to `e2e/soak/runs/<start time>/`, one event
per line with a UTC time. You get socket.io connects and disconnects with the reason and the
close code, and every WebSocket opening and closing, with whether the page closed it. You
also get ICE and peer connection states, the candidate pair, a `getStats` sample every 5
seconds, the app's console and whether the window shows the call. The app itself isn't
changed. An init script watches it, the way the nightly's `watchPeerConnections` does.
`status.txt` in the same folder has a line per client and gets rewritten every minute.

```bash
yarn vite build
GRYT_E2E_APP_PORT=3667 \
GRYT_TEST_SERVER_URL=https://test.gryt.chat GRYT_TEST_INVITE_CODE=… \
GRYT_SOAK_TUNNEL_SFU=wss://test-sfu.gryt.chat \
GRYT_SOAK_DIRECT_SERVER=http://192.168.50.147:5030 GRYT_SOAK_DIRECT_SFU=ws://192.168.50.147:5035 \
GRYT_SOAK_PING=192.168.50.1,192.168.50.147,1.1.1.1 \
  yarn playwright test --config e2e/soak/playwright.config.ts
node e2e/soak/report.mjs e2e/soak/runs/<run>
```

The report lists every drop with its reason, its close code and how long it took to come
back. Drops less than 30 seconds apart count as one incident. For each incident it prints the
`journalctl` window to read on dev.lan for the server, the SFU and cloudflared.

| Variable | Default | |
|---|---|---|
| `GRYT_SOAK_MINUTES` | 240 | How long the call stays up |
| `GRYT_SOAK_CLIENTS` | 3 | Call clients in the tunnel group |
| `GRYT_SOAK_DIRECT_CLIENTS` | 2 | Call clients in the direct group |
| `GRYT_SOAK_LOCAL_SERVER`, `GRYT_SOAK_LOCAL_SFU` | | A server and SFU on this machine, for the local group |
| `GRYT_SOAK_LOCAL_CLIENTS` | 2 | Call clients in the local group |
| `GRYT_SOAK_CAMERA` | 1 | `0` for audio only |
| `GRYT_SOAK_BROWSER_PROBE` | 1 | `0` leaves out the probe page |
| `GRYT_SOAK_OUT` | `e2e/soak/runs/<start time>` | Where the files go |

Without `GRYT_TEST_INVITE_CODE`, the tunnel and direct groups only get probes. Port 3667 is on
the test server's CORS list like 4173 is, and it leaves 4173 free for the nightly. To stop
early, create a file called `STOP` in the run's folder. The call clients then leave the call
and the server, like the nightly's guests do. On a Mac, `caffeinate -i -w <pid>` keeps the
machine awake until the run ends.
