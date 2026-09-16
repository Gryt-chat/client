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
