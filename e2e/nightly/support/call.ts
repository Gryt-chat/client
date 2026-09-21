import { expect, type Locator, type Page } from "@playwright/test";

import type { TestServer } from "./testServer";
import { connectedPeers, isPrivateAddress, peerStats } from "./webrtc";

export interface Guest {
  page: Page;
  name: string;
  /** Every WebSocket frame the page sent or received, as text. */
  frames: string[];
}

/** The default server's voice channel, which test.gryt.chat still has. */
export const VOICE_CHANNEL = process.env.GRYT_TEST_VOICE_CHANNEL || "Voice Chat";

export function leaveVoiceButton(page: Page): Locator {
  return page.getByRole("button", { name: "Leave voice channel" });
}

/** Whether a click at the element's centre lands on it. The voice panel clips its controls to nothing while minimized. */
function hittable(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.width > 0 && !!hit && element.contains(hit);
  });
}

/** Joining leaves the panel minimized when the window is new, and pressing the channel again opens it. */
export async function openVoicePanel(page: Page): Promise<void> {
  if (!(await hittable(leaveVoiceButton(page)))) {
    await page.getByRole("button", { name: VOICE_CHANNEL, exact: true }).click();
  }
  await expect.poll(() => hittable(leaveVoiceButton(page)), "the voice panel never opened").toBe(true);
}

export async function joinVoice(guest: Guest): Promise<void> {
  await guest.page.getByRole("button", { name: VOICE_CHANNEL, exact: true }).click();
  await expect(leaveVoiceButton(guest.page), `${guest.name} never got into ${VOICE_CHANNEL}`).toBeAttached();
  // A second press only toggles the panel once the client knows it's in the call, so wait for the call itself.
  await expect.poll(() => connectedPeers(guest.page), `${guest.name} never connected to the SFU`).toBeGreaterThan(0);
  await openVoicePanel(guest.page);
}

export async function leaveVoice(page: Page): Promise<void> {
  if ((await leaveVoiceButton(page).count()) === 0) return;
  await openVoicePanel(page);
  await leaveVoiceButton(page).click();
  await expect(leaveVoiceButton(page)).toHaveCount(0);
}

export async function turnCameraOn(guest: Guest): Promise<void> {
  await guest.page.getByRole("button", { name: "Turn camera on" }).click();
  const start = guest.page.getByRole("button", { name: "Start Camera" });
  await expect(start, "the camera preview never got a stream").toBeEnabled();
  await start.click();
  await expect(guest.page.getByRole("button", { name: "Turn camera off" })).toBeVisible();
}

/** In a browser the button calls getDisplayMedia straight away, and Chrome's fake capture answers it. */
export async function shareScreen(guest: Guest): Promise<void> {
  await guest.page.getByRole("button", { name: "Share your screen" }).click();
  await expect(guest.page.getByRole("button", { name: "Stop sharing your screen" })).toBeVisible();
}

export async function stopSharing(guest: Guest): Promise<void> {
  await guest.page.getByRole("button", { name: "Stop sharing your screen" }).click();
  await expect(guest.page.getByRole("button", { name: "Share your screen" })).toBeVisible();
}

function focusedView(page: Page): Locator {
  return page.locator('[data-gryt="voice-view"]').getByRole("button", { name: "Minimize" });
}

/** Pressing a video tile makes it the big one, which lays the call out again around it. */
export async function focusTile(page: Page, title: string): Promise<void> {
  // The tile takes the press, since its <video> ignores pointer events. After a layout change
  // the old copy fades out for a moment, so wait for one.
  const target = tile(page, title).filter({ has: page.locator("video") });
  await expect(target).toHaveCount(1);
  await target.click();
  await expect(focusedView(page), `pressing ${title}'s tile didn't focus it`).toBeAttached();
}

export async function unfocusTile(page: Page): Promise<void> {
  await focusedView(page).click();
  await expect(focusedView(page)).toHaveCount(0);
}

/** The distinct stream ids a guest announced in one field of a voice event, leaving out the empty ones. */
export function announcedStreams(guest: Guest, event: string, field: string): string[] {
  const prefix = `42["${event}",`;
  const ids = guest.frames
    .filter((frame) => frame.startsWith(prefix))
    .map((frame) => (JSON.parse(frame.slice(2)) as [string, Record<string, unknown>])[1][field])
    .filter((id): id is string => typeof id === "string" && id !== "");
  return [...new Set(ids)];
}

/** The id of the stream a tile's video is drawing. For somebody else's, that's the id their sender was made with. */
export function playedStream(video: Locator): Promise<string | null> {
  return video.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream | null)?.id ?? null);
}

/** Some audio arrives from the SFU, and then more: a connection that stalled after the first packet would pass a single read. */
export async function expectAudioArriving(guest: Guest): Promise<void> {
  const start = (await peerStats(guest.page)).audioBytesReceived;
  await expect
    .poll(async () => (await peerStats(guest.page)).audioBytesReceived, `${guest.name} received no audio`)
    .toBeGreaterThan(start + 1500);
}

export async function expectFramesDecoded(guest: Guest, what: string): Promise<void> {
  const start = (await peerStats(guest.page)).videoFramesDecoded;
  await expect
    .poll(async () => (await peerStats(guest.page)).videoFramesDecoded, `${guest.name} decoded no frames of ${what}`)
    .toBeGreaterThan(start + 30);
}

/** The pair ICE picked ends at an address the SFU offered, and for a public server not at a private one. */
export async function expectSfuAddress(guest: Guest, server: TestServer): Promise<void> {
  await expect.poll(async () => (await peerStats(guest.page)).remotes.length, "no candidate pair was selected").toBeGreaterThan(0);
  const { remotes, offered } = await peerStats(guest.page);
  const path = remotes.map((r) => `${r.address}:${r.port} (${r.type}, ${r.protocol})`).join(", ");
  // Logged, so the output of a red night shows which address media took.
  console.log(`${guest.name}'s media goes to ${path}`);
  for (const remote of remotes) {
    const where = `${remote.address}:${remote.port} (${remote.type}); the SFU offered ${offered.join(", ") || "nothing"}`;
    expect(offered, `${guest.name}'s media goes to ${where}`).toContain(remote.address);
    if (!server.private) {
      expect(isPrivateAddress(remote.address), `${guest.name}'s media goes to a private address, ${where}`).toBe(false);
    }
  }
}

/** The tile a person's name or "<name>'s Screen" labels. */
function tile(page: Page, title: string): Locator {
  const label = page.locator("span").filter({ hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
  return label.locator("xpath=../..");
}

/** The <video> in that tile. */
export function tileVideo(page: Page, title: string): Locator {
  return tile(page, title).locator("video");
}

/**
 * Drawn frames, not just an element: the width comes from a decoded frame, and the clock only runs while more arrive.
 * `forSeconds` of playing outlasts anything the other guest's last change still has in flight.
 */
export async function expectPlaying(video: Locator, forSeconds = 0): Promise<void> {
  await expect(video, "the tile has no video, only its placeholder").toBeAttached();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), "the video never got a frame").toBeGreaterThan(0);
  const start = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), "the video stopped")
    .toBeGreaterThan(start + forSeconds);
}
