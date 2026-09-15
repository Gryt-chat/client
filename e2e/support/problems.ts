import type { Page } from "@playwright/test";

interface Allowed {
  text: RegExp;
  /** Where the message came from. For a failed request, the request's URL. */
  url?: RegExp;
}

/** Error-level console output that is known and harmless. Each entry says why it is here. */
const ALLOWED: Allowed[] = [
  // The server won't preview private addresses and answers 400. The paste test
  // sends a LAN address on purpose, and Chrome logs the refusal.
  { text: /status of 400 \(Bad Request\)/, url: /\/api\/link-preview\?url=http%3A%2F%2F192\.168\./ },
  // The Audio settings page asks for a microphone when it opens, and headless Chromium has none (NotSupportedError
  // on macOS, NotFoundError on CI's Linux). Fake devices keep the level meter moving, so settled() never returns.
  { text: /^Error enumerating devices: (NotSupportedError: Not supported|NotFoundError: Requested device not found)$/ },
];

/** Everything that should fail a test without an assertion asking: console errors, crashes, live sites. */
export class ProblemLog {
  readonly problems: string[] = [];

  report = (problem: string) => {
    this.problems.push(problem);
  };

  watch(page: Page, who: string, serverHttpBase: string) {
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      const { url, lineNumber } = msg.location();
      if (ALLOWED.some((a) => a.text.test(text) && (!a.url || a.url.test(url)))) return;
      this.report(`[${who}] console.error: ${text}${url ? `\n    at ${url}:${lineNumber}` : ""}`);
    });
    page.on("pageerror", (err) => {
      this.report(`[${who}] uncaught ${err.stack ?? err.message}`);
    });
    page.on("response", (res) => {
      const status = res.status();
      if (!res.url().startsWith(serverHttpBase)) return;
      if (status === 429 || status >= 500) this.report(`[${who}] test server answered ${status}: ${res.url()}`);
    });
  }

  /** Thrown from fixture teardown, which fails the test that was running. */
  assertClean() {
    if (this.problems.length === 0) return;
    throw new Error(`${this.problems.length} problem(s) outside the assertions:\n\n${this.problems.join("\n\n")}`);
  }
}
