import { type BrowserContext, expect, type Locator, type Page } from "@playwright/test";

export interface Member {
  context: BrowserContext;
  page: Page;
  /** The nickname the app picked for this guest. */
  name: string;
  /** Every WebSocket frame the page sent or received, as text. */
  frames: string[];
}

export function recordFrames(page: Page): string[] {
  const frames: string[] = [];
  const keep = (payload: string | Buffer) => frames.push(payload.toString());
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => keep(payload));
    socket.on("framereceived", ({ payload }) => keep(payload));
  });
  return frames;
}

export function composer(page: Page, placeholder: string): Locator {
  return page.locator(`[role="textbox"][aria-placeholder="${placeholder}"]`);
}

export function channelComposer(page: Page, channel = "General"): Locator {
  return composer(page, `Message #${channel}`);
}

/** A message the server has confirmed. Until then its id is `pending-…`, and for a moment both rows are drawn. */
export const CONFIRMED_ROW = '[data-message-id]:not([data-message-id^="pending-"])';

export function messageRow(page: Page, text: string | RegExp): Locator {
  return page.locator(CONFIRMED_ROW).filter({ hasText: text });
}

export async function joinServer(page: Page, host: string): Promise<void> {
  await page.getByRole("button", { name: "Add a server" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Join a server" });
  await dialog.getByLabel("Invite or server address").fill(host);
  await expect(dialog.getByText("No account needed")).toBeVisible();
  await dialog.getByRole("button", { name: "Join", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(channelComposer(page)).toBeVisible();
}

/** The user store keeps one key per setting, prefixed with whoever is loaded. */
export async function userValue<T>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((suffix) => {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name?.startsWith("user:") && name.endsWith(`:${suffix}`)) {
        return JSON.parse(localStorage.getItem(name) ?? "null");
      }
    }
    return null;
  }, key);
}

export async function setUserValue(page: Page, key: string, value: unknown): Promise<void> {
  const written = await page.evaluate(
    ([suffix, json]) => {
      for (let i = 0; i < localStorage.length; i++) {
        const name = localStorage.key(i);
        if (name?.startsWith("user:") && name.endsWith(`:${suffix}`)) {
          localStorage.setItem(name, json);
          return true;
        }
      }
      return false;
    },
    [key, JSON.stringify(value)] as const,
  );
  expect(written, `no user value called ${key} to overwrite`).toBe(true);
}

export async function nicknameOf(page: Page): Promise<string | null> {
  return userValue<string>(page, "nickname");
}

/** Types into the composer, sends with one Enter, and waits for the server to confirm the message. */
export async function sendMessage(page: Page, text: string, channel = "General"): Promise<Locator> {
  const box = channelComposer(page, channel);
  await box.click();
  await page.keyboard.insertText(text);
  await box.press("Enter");
  await expect(box).toHaveText("");
  const row = messageRow(page, text);
  await expect(row).toBeVisible();
  await expect(page.locator('[data-message-id^="pending-"]').filter({ hasText: text })).toHaveCount(0);
  return row;
}

export function membersPanel(page: Page): Locator {
  return page.getByRole("complementary", { name: "Members" });
}

/** Unique per call, so tests sharing a server never match each other's messages. Digits only, for the profanity filter. */
export function unique(label: string): string {
  return `${label} ${Date.now()}${Math.floor(Math.random() * 1000)}`;
}
