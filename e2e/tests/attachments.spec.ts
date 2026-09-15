import { fileURLToPath } from "node:url";

import type { Page, Request } from "@playwright/test";

import { channelComposer, CONFIRMED_ROW } from "../support/app";
import { expect, test } from "../support/fixtures";

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

async function attachAndSend(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach file" }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole("button", { name: "Remove file" })).toBeVisible();
  await channelComposer(page).press("Enter");
  await expect(page.getByRole("button", { name: "Remove file" })).toBeHidden();
}

test("an uploaded image loads for the sender and the other members", async ({ newMember, gryt }) => {
  const alice = await newMember();
  const bob = await newMember();

  await attachAndSend(alice.page, fixture("gradient.png"));

  for (const page of [alice.page, bob.page]) {
    const image = page.locator(`${CONFIRMED_ROW} img[alt="gradient.png"]`);
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(96);
  }
  const src = await bob.page.locator(`${CONFIRMED_ROW} img[alt="gradient.png"]`).getAttribute("src");
  expect(src).toContain(`${gryt.server.httpBase}/api/uploads/files/`);
});

test("a video attachment doesn't download until play is pressed", async ({ newMember, gryt }) => {
  const alice = await newMember();
  const bob = await newMember();

  const isVideoFetch = (request: Request) => {
    const url = new URL(request.url());
    return (
      url.origin === gryt.server.httpBase &&
      url.pathname.startsWith("/api/uploads/files/") &&
      url.searchParams.get("thumb") !== "1"
    );
  };
  const fetches: string[] = [];
  bob.page.on("request", (request) => {
    if (isVideoFetch(request)) fetches.push(request.url());
  });

  await attachAndSend(alice.page, fixture("clip.webm"));

  const player = bob.page.locator(`${CONFIRMED_ROW} .gryt-video-player`).filter({ hasText: "clip.webm" });
  await expect(player).toBeVisible();
  const video = player.locator("video");
  await expect(video).toHaveCount(1);
  await expect(video).not.toHaveAttribute("src", /.+/);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentSrc)).toBe("");
  expect(fetches, "the video was fetched before anybody pressed play").toEqual([]);

  const fetched = bob.page.waitForRequest(isVideoFetch);
  await player.getByRole("button", { name: "Play video" }).click();
  await fetched;
  await expect(video).toHaveAttribute("src", new RegExp(`^${gryt.server.httpBase}/api/uploads/files/`));
});
