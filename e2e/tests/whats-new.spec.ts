import type { Locator, Page } from "@playwright/test";

import { channelComposer, setUserValue, userValue } from "../support/app";
import { APP_VERSION, serveChangelog } from "../support/external";
import { expect, test } from "../support/fixtures";

const LINE = "A release made up for the end-to-end tests.";
const SECURITY = "Security fixes get a block of their own, above the rest.";

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

/** The block's colours next to the theme's own danger red, and how well its heading reads. */
function securityColours(block: Locator) {
  return block.evaluate((el) => {
    const probe = (value: string) => {
      const span = document.createElement("span");
      span.style.color = value;
      el.append(span);
      const colour = getComputedStyle(span).color;
      span.remove();
      return colour;
    };
    const luminance = (colour: string) => {
      const [r, g, b] = (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => {
        const c = Number(part) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const background = getComputedStyle(el).backgroundColor;
    const heading = getComputedStyle(el.querySelector(".whats-new-area")!).color;
    const [light, dark] = [luminance(heading), luminance(background)].sort((a, b) => b - a);
    return {
      background,
      heading,
      danger2: probe("var(--gryt-danger-2)"),
      danger11: probe("var(--gryt-danger-11)"),
      card: getComputedStyle(el.closest('[role="dialog"]')!).backgroundColor,
      contrast: (light + 0.05) / (dark + 0.05),
    };
  });
}

test("What's new after an update puts the line first, security in a red block, then a heading per area", async ({
  newMember,
}) => {
  const { page } = await newMember();
  await updateFrom1100(page);

  const dialog = page.getByRole("dialog", { name: "Here’s what’s new in Gryt Chat" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".whats-new-body > :first-child")).toHaveText(LINE);
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveText([
    "Security",
    "Chat",
    "Servers & invites",
    "Settings & app",
  ]);
  const changes = dialog.locator("li.whats-new-change");
  await expect(changes.locator(".whats-new-kind")).toHaveText(["Security", "Fixed", "Fixed", "New"]);
  await expect(changes.locator("p")).toHaveText([
    SECURITY,
    "The first Enter after a pasted address sends it.",
    "Server settings fit on a phone.",
    "Every change in this dialog gets its own pill.",
  ]);

  // The security fix is in the block and nowhere else, though its area is Chat.
  const security = dialog.locator(".whats-new-security");
  await expect(security.locator("li p")).toHaveText([SECURITY]);
  await expect(dialog.getByText(SECURITY)).toHaveCount(1);

  // The theme's danger red in both appearances, readable, and set apart from the card.
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${scheme}\\b`));
    const colours = await securityColours(security);
    expect(colours.background, scheme).toBe(colours.danger2);
    expect(colours.heading, scheme).toBe(colours.danger11);
    expect(colours.background, scheme).not.toBe(colours.card);
    expect(colours.contrast, scheme).toBeGreaterThanOrEqual(4.5);
  }

  // The desktop app's narrowest window. Each pill moves above its change, and nothing runs off the card.
  await page.setViewportSize({ width: 300, height: 600 });
  const narrow = await dialog.evaluate((card) => {
    const box = (el: Element) => el.getBoundingClientRect();
    const pad = card.querySelector(".whats-new-pad")!;
    const block = card.querySelector(".whats-new-security")!;
    const row = card.querySelector(".whats-new-group:not(.whats-new-security) .whats-new-change")!;
    return {
      sideways: pad.scrollWidth - pad.clientWidth,
      body: Math.round(box(card.querySelector(".whats-new-body")!).width),
      headings: [...card.querySelectorAll(".whats-new-group:not(.whats-new-security) > .whats-new-area")].map((h) =>
        Math.round(box(h).width),
      ),
      lineAbove: box(card.querySelector(".whats-new-line")!).bottom <= box(block).top,
      blockInside: box(block).left >= box(pad).left && box(block).right <= box(pad).right,
      pillAbove: box(row.querySelector(".whats-new-kind")!).bottom <= box(row.querySelector("p")!).top,
    };
  });
  expect(narrow.sideways).toBe(0);
  expect(narrow.headings).toEqual([narrow.body, narrow.body, narrow.body]);
  expect(narrow.lineAbove).toBe(true);
  expect(narrow.blockInside).toBe(true);
  expect(narrow.pillAbove).toBe(true);

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => userValue<string>(page, "whatsNewSeenVersion")).toBe(APP_VERSION);
});

test("What's new from a site that has no areas still leads with the line and the security block", async ({
  newMember,
}) => {
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
  await expect(dialog.locator(".whats-new-body > :first-child")).toHaveText(LINE);
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(["Security"]);
  await expect(dialog.locator("li.whats-new-change .whats-new-kind")).toHaveText(["Security", "New", "Fixed", "Fixed"]);
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
  await expect(releases.locator(".whats-new-body > :first-child")).toHaveText([LINE, older.line]);
  await expect(releases.nth(0).getByRole("heading", { level: 4 })).toHaveText([
    "Security",
    "Chat",
    "Servers & invites",
    "Settings & app",
  ]);
  await expect(releases.nth(1).getByRole("heading", { level: 4 })).toHaveCount(0);
  await expect(releases.nth(1).locator(".whats-new-kind")).toHaveText(["New", "Fixed"]);
});


test("The area heading stays at the top of the list while you are reading that area", async ({ newMember }) => {
  const { page } = await newMember();
  const areas = ["voice", "chat", "servers", "settings"];
  await serveChangelog(page, (feed) => ({
    ...feed,
    app: [
      {
        ...feed.app[0],
        changes: areas.flatMap((area) =>
          Array.from({ length: 4 }, (_, i) => ({
            kind: "fixed",
            area,
            text: `A ${area} fix, number ${i + 1}, written long enough to take a line of the card on its own.`,
          })),
        ),
      },
      ...feed.app.slice(1),
    ],
  }));
  await updateFrom1100(page);

  const dialog = page.getByRole("dialog", { name: "Here’s what’s new in Gryt Chat" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveText([
    "Voice & video",
    "Chat",
    "Servers & invites",
    "Settings & app",
  ]);

  // Each area has a mark of its own beside its name, and no two areas share one.
  const marks = await dialog.locator(".whats-new-area svg").evaluateAll((svgs) => svgs.map((svg) => svg.innerHTML));
  expect(marks).toHaveLength(4);
  expect(new Set(marks).size).toBe(4);

  const scrolled = await dialog.evaluate((card) => {
    const pad = card.querySelector(".whats-new-pad")!;
    const top = () => pad.getBoundingClientRect().top;
    const headings = [...card.querySelectorAll(".whats-new-area")];
    const held = () => headings.filter((h) => Math.abs(h.getBoundingClientRect().top - top()) < 1).map((h) => h.textContent);

    /* Stopped halfway down each area: the one heading held at the top of the list
       is that area's, whichever rows happen to be on screen. */
    const inside: [string | null, (string | null)[]][] = [];
    for (const group of card.querySelectorAll(".whats-new-group:not(.whats-new-security)")) {
      const box = () => group.getBoundingClientRect();
      pad.scrollTop += box().top - top() + box().height / 2;
      if (box().top - top() >= 0 || box().bottom - top() <= 40) continue;
      inside.push([group.querySelector(".whats-new-area")!.textContent, held()]);
    }

    // And nowhere on the way down does a heading come down over the one below it.
    const over: number[] = [];
    for (let y = 0; y <= pad.scrollHeight - pad.clientHeight; y += 4) {
      pad.scrollTop = y;
      const boxes = headings.map((h) => h.getBoundingClientRect()).filter((r) => r.bottom > top() && r.top < top() + pad.clientHeight);
      if (boxes.some((r, i) => i > 0 && r.top < boxes[i - 1].bottom - 0.5)) over.push(y);
    }
    return { inside, over, scrolls: pad.scrollHeight > pad.clientHeight };
  });

  expect(scrolled.scrolls).toBe(true);
  expect(scrolled.inside.length).toBeGreaterThan(1);
  for (const [area, heldThere] of scrolled.inside) expect(heldThere, area ?? "").toEqual([area]);
  expect(scrolled.over).toEqual([]);
});
