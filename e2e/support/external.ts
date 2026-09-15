import { readFileSync } from "node:fs";

import type { BrowserContext, Page, Route } from "@playwright/test";

const FIXTURES = new URL("../fixtures/", import.meta.url);
const APP_VERSION = (
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
).version;

/** Everything off this machine. The app and the test servers are all on 127.0.0.1. */
const OFF_MACHINE = /^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/;

const CORS = { "access-control-allow-origin": "*" };

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
}

/** What Keycloak answers a browser with no session, so the app settles as a guest at once. */
function auth(route: Route, url: URL) {
  const realm = "/realms/gryt";
  if (url.pathname === realm) return json(route, { realm: "gryt" });
  if (url.pathname.startsWith(`${realm}/protocol/openid-connect/3p-cookies/`)) {
    const body = `<script>parent.postMessage("supported", "*")</script>`;
    return route.fulfill({ status: 200, contentType: "text/html", body });
  }
  if (url.pathname === `${realm}/protocol/openid-connect/auth`) {
    const back = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    return route.fulfill({ status: 302, headers: { location: `${back}#error=login_required&state=${state}` } });
  }
  return null;
}

function changelog(): string {
  return readFileSync(new URL("changelog.json", FIXTURES), "utf8").replaceAll('"current"', JSON.stringify(APP_VERSION));
}

function fixtureFor(route: Route, url: URL) {
  switch (url.host) {
    case "auth.gryt.chat":
      return auth(route, url);
    case "community.gryt.chat":
      if (url.pathname !== "/info") return null;
      return json(route, { name: "Gryt Community", description: "Fixture", members: "1", identityTiers: ["account"], joinPolicy: "open" });
    case "gryt.chat":
      if (url.pathname === "/changelog.json") {
        return route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: changelog() });
      }
      return url.pathname === "/" ? route.fulfill({ status: 200, body: "" }) : null;
    case "status.gryt.chat":
      if (url.pathname === "/api/v1/config") return json(route, { announcements: [] });
      return url.pathname === "/" ? route.fulfill({ status: 200, body: "" }) : null;
    default:
      return null;
  }
}

/** The fixture changelog with these security notices in it, for one page. A page's routes win over its context's. */
export async function serveSecurityNotices(page: Page, notices: unknown[]) {
  const url = "https://gryt.chat/changelog.json";
  const body = JSON.stringify({ ...(JSON.parse(changelog()) as object), securityNotices: notices });
  await page.unroute(url);
  await page.route(url, (route) => route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body }));
}

/** Stands in for every live site the app calls, and blocks and reports anything it doesn't know. */
export async function routeExternal(
  context: BrowserContext,
  report: (problem: string) => void,
  /** Hosts the test means to reach for real, such as the nightly suite's server. */
  allowHosts: string[] = [],
) {
  await context.route(OFF_MACHINE, (route) => {
    const url = new URL(route.request().url());
    if (allowHosts.includes(url.host)) return route.continue();
    const handled = fixtureFor(route, url);
    if (handled) return handled;
    report(`Request to a live site with no fixture: ${route.request().method()} ${url.href}`);
    return route.abort("blockedbyclient");
  });
}

export { APP_VERSION };
