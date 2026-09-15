import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type BrowserContext, type BrowserContextOptions, expect, test as base } from "@playwright/test";

import { channelComposer, joinServer, type Member, membersPanel, nicknameOf, recordFrames } from "./app";
import { routeExternal } from "./external";
import { ProblemLog } from "./problems";
import { externalServer, type GrytServer, type ServerOptions, startServer } from "./server";

interface Gryt {
  server: GrytServer;
  /** Joined before anybody else, so it owns the server. Pages come and go; the identity stays. */
  ownerContext: BrowserContext;
  ownerName: string;
  /** Whichever test is running, so the owner's pages report into it. */
  log: { current: ProblemLog };
}

export interface MemberOptions {
  /** A touch screen at 390x844. Below 520px a mouse gets one channel and no menus. */
  phone?: boolean;
  /** Leave the first-run welcome up, for the one test that goes through it. */
  welcome?: boolean;
  join?: boolean;
  /** Another server than the worker's, such as one from `freshServer`. */
  server?: GrytServer;
  label?: string;
}

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

/** Digits only: the server's profanity filter is on, and a random run of letters can spell something. */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Math.floor(Math.random() * 1e6)}`;
}

/** The app picks from 152 names, so members of one worker's server would soon share one. */
export async function prepare(
  context: BrowserContext,
  report: (problem: string) => void,
  { nickname, welcome = false, allowHosts }: { nickname: string; welcome?: boolean; allowHosts?: string[] },
) {
  await routeExternal(context, report, allowHosts);
  await context.addInitScript(
    ({ nickname, welcome }) => {
      try {
        if (!localStorage.getItem("gryt.deviceId")) {
          const device = `device:${crypto.randomUUID()}`;
          localStorage.setItem("gryt.deviceId", device);
          localStorage.setItem(`user:${device}:nickname`, JSON.stringify(nickname));
        }
        if (!welcome) localStorage.setItem("gryt.hasSeenWelcome", "true");
      } catch {
        // An opaque origin, such as a fixture's iframe.
      }
    },
    { nickname, welcome },
  );
}

function appUrl(): string {
  const url = process.env.GRYT_E2E_APP_URL;
  if (!url) throw new Error("GRYT_E2E_APP_URL is unset; run the suite through e2e/playwright.config.ts.");
  return url;
}

export const test = base.extend<
  {
    problems: ProblemLog;
    newMember: (options?: MemberOptions) => Promise<Member>;
    owner: Member;
    freshServer: (options?: ServerOptions) => Promise<GrytServer>;
  },
  { gryt: Gryt }
>({
  gryt: [
    async ({ browser }, provide, workerInfo) => {
      const external = process.env.GRYT_E2E_SERVER;
      const server = external
        ? await externalServer(external)
        : await startServer(new URL(appUrl()).origin, process.env.GRYT_E2E_RUN_ID ?? "local");

      const log = { current: new ProblemLog() };
      const ownerContext = await browser.newContext({ baseURL: appUrl(), viewport: { width: 1280, height: 800 } });
      const ownerName = uniqueName("Owner");
      await prepare(ownerContext, (problem) => log.current.report(problem), { nickname: ownerName });

      const page = await ownerContext.newPage();
      log.current.watch(page, "owner", server.httpBase);
      await page.goto("/");
      await expect.poll(() => nicknameOf(page), "the seeded nickname should be the one in use").toBe(ownerName);
      await joinServer(page, server.host);
      const owners = membersPanel(page).getByRole("region", { name: /^owner/i });
      await expect(owners, "the first guest to join should own the server").toContainText(ownerName);
      await page.close();
      log.current.assertClean();

      await provide({ server, ownerContext, ownerName, log });

      await ownerContext.close();
      if (server.containerId) {
        const dir = join(workerInfo.project.outputDir, "server-logs");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `worker-${workerInfo.workerIndex}.log`), await server.logs());
      }
      await server.stop();
    },
    { scope: "worker", timeout: 120_000 },
  ],

  problems: [
    async ({ gryt }, provide, testInfo) => {
      const log = new ProblemLog();
      gryt.log.current = log;
      await provide(log);
      if (testInfo.status !== testInfo.expectedStatus && gryt.server.containerId) {
        await testInfo.attach("server.log", { body: await gryt.server.logs(), contentType: "text/plain" });
      }
      log.assertClean();
    },
    { auto: true },
  ],

  // eslint-disable-next-line no-empty-pattern -- Playwright reads fixture needs from this pattern.
  freshServer: async ({}, provide) => {
    const started: GrytServer[] = [];
    await provide(async (options) => {
      if (process.env.GRYT_E2E_SERVER) throw new Error("This test needs a server of its own, so it can't use GRYT_E2E_SERVER.");
      const server = await startServer(new URL(appUrl()).origin, process.env.GRYT_E2E_RUN_ID ?? "local", options);
      started.push(server);
      return server;
    });
    for (const server of started) await server.stop();
  },

  // Needs freshServer so those servers stop after these pages close. Stopped sooner, a page's reconnect logs an error.
  newMember: async ({ browser, gryt, problems, freshServer }, provide) => {
    void freshServer;
    const contexts: BrowserContext[] = [];
    await provide(async (options = {}) => {
      const label = options.label ?? `guest ${contexts.length + 1}`;
      const server = options.server ?? gryt.server;
      const name = uniqueName(`Guest${contexts.length + 1}`);
      const context = await browser.newContext(options.phone ? PHONE : {});
      contexts.push(context);
      await prepare(context, problems.report, { nickname: name, welcome: options.welcome });
      const page = await context.newPage();
      problems.watch(page, label, server.httpBase);
      const frames = recordFrames(page);
      await page.goto("/");
      await expect.poll(() => nicknameOf(page), "the seeded nickname should be the one in use").toBe(name);
      if (options.join !== false) await joinServer(page, server.host);
      return { context, page, name, frames };
    });
    for (const context of contexts) await context.close();
  },

  owner: async ({ gryt, problems }, provide) => {
    const page = await gryt.ownerContext.newPage();
    problems.watch(page, "owner", gryt.server.httpBase);
    const frames = recordFrames(page);
    await page.goto("/");
    await expect(channelComposer(page)).toBeVisible();
    await provide({ context: gryt.ownerContext, page, name: gryt.ownerName, frames });
    await page.close();
  },
});

export { expect };
