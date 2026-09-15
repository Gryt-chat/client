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
  own identity and a unique nickname. Pass `{ phone: true }` for a 390x844 touch screen, or
  `{ join: false }` to stop at the empty app.
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
