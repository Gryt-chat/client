import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { type BrowserContext, expect, type Locator, type Page } from "@playwright/test";

import { accessTokenOf, withSocket } from "./admin";
import type { GrytServer } from "./server";

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
  await joinFromDialog(page, host);
}

/** For a page already in a server: the empty app's button is gone, and the rail's plus is left. */
export async function joinAnotherServer(page: Page, host: string): Promise<void> {
  await page.locator('[data-tour="add-server"]').click();
  await joinFromDialog(page, host);
}

async function joinFromDialog(page: Page, host: string): Promise<void> {
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

/** Pastes through the clipboard with the keyboard. The page's context needs clipboard-read and clipboard-write. */
export async function pasteText(page: Page, box: Locator, text: string): Promise<void> {
  await box.click();
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press("ControlOrMeta+V");
}

/** A file in e2e/fixtures, as a path a file chooser takes. */
export function fixture(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Attaches files with the paperclip and sends them with one Enter in `box`. */
export async function attachAndSend(page: Page, files: string[], box: Locator = channelComposer(page)): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach file" }).click();
  await (await chooser).setFiles(files);
  await expect(page.getByRole("button", { name: "Remove file" })).toHaveCount(files.length);
  await box.press("Enter");
  await expect(page.getByRole("button", { name: "Remove file" })).toHaveCount(0);
}

/** Runs `press`, waits for the download it starts, and returns its name and the hash of what landed. */
export async function savedFile(page: Page, press: () => Promise<void>): Promise<{ name: string; sha256: string }> {
  const [download] = await Promise.all([page.waitForEvent("download"), press()]);
  return { name: download.suggestedFilename(), sha256: sha256(readFileSync(await download.path())) };
}

/** Whether the clipboard holds a PNG with the same pixels as the fixture `name`. */
export async function clipboardHoldsImage(page: Page, name: string): Promise<boolean | string> {
  return page.evaluate(async (expectedBase64) => {
    const item = (await navigator.clipboard.read()).find((it) => it.types.includes("image/png"));
    if (!item) return "no image on the clipboard";
    const pixels = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
    };
    const expected = await pixels(new Blob([Uint8Array.from(atob(expectedBase64), (c) => c.charCodeAt(0))]));
    const copied = await pixels(await item.getType("image/png"));
    if (copied.width !== expected.width || copied.height !== expected.height) return `copied ${copied.width}x${copied.height}`;
    return copied.data.every((value, i) => value === expected.data[i]);
  }, readFileSync(fixture(name)).toString("base64"));
}

export function membersPanel(page: Page): Locator {
  return page.getByRole("complementary", { name: "Members" });
}

/** Unique per call, so tests sharing a server never match each other's messages. Digits only, for the profanity filter. */
export function unique(label: string): string {
  return `${label} ${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/** A channel's row in the sidebar. Not `getByRole` with an exact name: an unread
    badge sits inside the button and joins its accessible name. */
export function sidebarChannelRow(page: Page, name: string): Locator {
  return page
    .getByRole("navigation", { name: "Channels" })
    .locator("button")
    .filter({ has: page.locator(`span.truncate:text-is("${name}")`) });
}

/** What a sidebar row is counting, as text. Absent when there is nothing waiting. */
export function unreadBadge(row: Locator): Locator {
  return row.locator(".gryt-badge");
}

/** A text channel made with the owner's token, waited for in the owner's sidebar. */
export async function addChannel(owner: Page, server: GrytServer, name: string): Promise<void> {
  const accessToken = await accessTokenOf(owner, server.host);
  await withSocket(server.httpBase, async (socket) => {
    const refused = new Promise<never>((_, reject) =>
      socket.once("server:error", (e: { message?: string }) => reject(new Error(`Making #${name} was refused: ${e?.message}`))),
    );
    refused.catch(() => undefined);
    socket.emit("server:channels:upsert", { accessToken, name, type: "text" });
    // The new channel list goes to members, not to this socket.
    await Promise.race([expect(sidebarChannelRow(owner, name)).toBeVisible(), refused]);
  });
}
