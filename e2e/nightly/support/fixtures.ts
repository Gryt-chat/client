import { expect, test as base } from "@playwright/test";

import { channelComposer, joinServer, recordFrames } from "../../support/app";
import { prepare, uniqueName } from "../../support/fixtures";
import { ProblemLog } from "../../support/problems";
import { type Guest, leaveVoice } from "./call";
import { type TestServer, testServer } from "./testServer";
import { watchPeerConnections } from "./webrtc";

/** Off CI this machine may sit on the SFU's own LAN, where a call never touches the public path. */
const HIDE_LOCAL_CANDIDATES = !process.env.CI && process.env.GRYT_E2E_SEND_LOCAL_CANDIDATES !== "1";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Out of the call and off the server, so the shared server doesn't collect a member per run. */
async function leave(guest: Guest, server: TestServer, report: (problem: string) => void): Promise<void> {
  const { page } = guest;
  // Leaving the server ends the call on the server's side too, so a stuck panel mustn't stop that.
  await leaveVoice(page).catch((err: Error) => report(`${guest.name} could not leave the call: ${err.message}`));
  if (!(await channelComposer(page).isVisible())) return;

  await page.getByRole("button", { name: "Server menu" }).click();
  await page.getByRole("menuitem", { name: "Leave server" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave server" }).click();
  const outcome = page.getByText(new RegExp(`^Left ${escape(server.host)}$|You own this server`));
  await expect(outcome, `${guest.name} is still a member of ${server.host}`).toHaveText(`Left ${server.host}`);
}

export const test = base.extend<{ problems: ProblemLog; server: TestServer; guest: () => Promise<Guest> }>({
  problems: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads fixture needs from this pattern.
    async ({}, provide) => {
      const log = new ProblemLog();
      await provide(log);
      log.assertClean();
    },
    { auto: true },
  ],

  // eslint-disable-next-line no-empty-pattern -- Playwright reads fixture needs from this pattern.
  server: async ({}, provide) => {
    await provide(testServer());
  },

  guest: async ({ browser, problems, server }, provide) => {
    const joined: { guest: Guest; close: () => Promise<void> }[] = [];
    await provide(async () => {
      const name = uniqueName("Nightly");
      const context = await browser.newContext();
      await prepare(context, problems.report, { nickname: name, allowHosts: [server.host] });
      await watchPeerConnections(context, HIDE_LOCAL_CANDIDATES);

      const page = await context.newPage();
      const guest = { page, name, frames: recordFrames(page) };
      joined.push({ guest, close: () => context.close() });
      problems.watch(page, name, server.httpBase);
      await page.goto("/");
      await joinServer(page, server.invite);
      return guest;
    });

    const leftBehind: string[] = [];
    const report = (problem: string) => leftBehind.push(problem);
    for (const { guest, close } of joined) {
      await leave(guest, server, report).catch((err: Error) => report(`${guest.name}: ${err.message}`));
      await close();
    }
    expect(leftBehind, "guests left behind on the test server").toEqual([]);
  },
});

export { expect };
