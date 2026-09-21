import type { Page } from "@playwright/test";

import { channelComposer, setUserValue, userValue } from "../support/app";
import { APP_VERSION, serveChangelog } from "../support/external";
import { expect, test } from "../support/fixtures";

/** Pretends this install ran 1.10.0 last, then reloads into the running version. */
async function updateFrom1100(page: Page) {
  // A fresh install records the running version as seen, so it has to be put back.
  await expect.poll(() => userValue<string>(page, "whatsNewSeenVersion")).toBe(APP_VERSION);
  await setUserValue(page, "whatsNewSeenVersion", "1.10.0");

  const changelog = page.waitForResponse("https://gryt.chat/changelog.json");
  await page.reload();
  await changelog;
  await expect(channelComposer(page)).toBeVisible();
}

test("What's new after an update puts a heading over each area, with a pill for each change", async ({
  newMember,
}) => {
  const { page } = await newMember();
  await updateFrom1100(page);

  const dialog = page.getByRole("dialog", { name: "Here’s what’s new in Gryt Chat" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(["Chat", "Servers & invites", "Settings & app"]);
  const changes = dialog.locator("li.whats-new-change");
  await expect(changes.locator(".whats-new-kind")).toHaveText(["Fixed", "Fixed", "New"]);
  await expect(changes.locator("p")).toHaveText([
    "The first Enter after a pasted address sends it.",
    "Server settings fit on a phone.",
    "Every change in this dialog gets its own pill.",
  ]);

  // The desktop app's narrowest window. Each pill moves above its change, and nothing runs off the card.
  await page.setViewportSize({ width: 300, height: 600 });
  const narrow = await dialog.evaluate((card) => {
    const box = (el: Element) => el.getBoundingClientRect();
    const pad = card.querySelector(".whats-new-pad")!;
    const row = card.querySelector(".whats-new-change")!;
    return {
      sideways: pad.scrollWidth - pad.clientWidth,
      list: Math.round(box(card.querySelector(".whats-new-areas")!).width),
      headings: [...card.querySelectorAll(".whats-new-area")].map((h) => Math.round(box(h).width)),
      pillAbove: box(row.querySelector(".whats-new-kind")!).bottom <= box(row.querySelector("p")!).top,
    };
  });
  expect(narrow.sideways).toBe(0);
  expect(narrow.headings).toEqual([narrow.list, narrow.list, narrow.list]);
  expect(narrow.pillAbove).toBe(true);

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => userValue<string>(page, "whatsNewSeenVersion")).toBe(APP_VERSION);
});

test("What's new from a site that has no areas is one list, as before", async ({ newMember }) => {
  const { page } = await newMember();
  await serveChangelog(page, (feed) => ({
    ...feed,
    app: feed.app.map((release) => ({
      ...release,
      changes: (release.changes as Record<string, unknown>[] | undefined)?.map(({ kind, text }) => ({ kind, text })),
    })),
  }));
  await updateFrom1100(page);

  const dialog = page.getByRole("dialog", { name: "Here’s what’s new in Gryt Chat" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveCount(0);
  await expect(dialog.locator("li.whats-new-change .whats-new-kind")).toHaveText(["New", "Fixed", "Fixed"]);
});

test("What's new across several releases groups each one on its own", async ({ newMember }) => {
  const { page } = await newMember();
  const older = {
    version: "1.10.1",
    date: "2026-09-08",
    line: "A release from before areas.",
    changes: [
      { kind: "fixed", text: "A release from before areas stays one list." },
      { kind: "new", text: "Its pills are still in kind order." },
    ],
  };
  await serveChangelog(page, (feed) => ({ ...feed, app: [feed.app[0], older, ...feed.app.slice(1)] }));
  await updateFrom1100(page);

  const dialog = page.getByRole("dialog", { name: "What’s new since 1.10.0" });
  await expect(dialog).toBeVisible();
  const releases = dialog.locator("section.whats-new-release");
  await expect(releases).toHaveCount(2);
  await expect(releases.nth(0).getByRole("heading", { level: 4 })).toHaveText([
    "Chat",
    "Servers & invites",
    "Settings & app",
  ]);
  await expect(releases.nth(1).getByRole("heading", { level: 4 })).toHaveCount(0);
  await expect(releases.nth(1).locator(".whats-new-kind")).toHaveText(["New", "Fixed"]);
});
