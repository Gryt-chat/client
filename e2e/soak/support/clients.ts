import { createRequire } from "node:module";

import { type Browser, type BrowserContext, chromium, expect, type Page } from "@playwright/test";

import { leaveVoiceButton, VOICE_CHANNEL } from "../../nightly/support/call";
import { connectedPeers, watchPeerConnections } from "../../nightly/support/webrtc";
import { channelComposer, joinServer } from "../../support/app";
import { prepare, uniqueName } from "../../support/fixtures";
import type { Group } from "./config";
import type { Fields } from "./jsonl";
import { type PageScriptConfig, soakPageScript } from "./pageScript";
import { redact } from "./redact";
import type { Tracker } from "./tracker";

const STATS_INTERVAL_MS = 5000;

/** Chrome's fake camera and microphone, and no throttling: a call keeps a desktop window busy anyway. */
export const BROWSER_ARGS = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
];

/** Everything the page and Chromium's network stack say about the page, into its log. */
async function wirePage(page: Page, track: Tracker): Promise<void> {
  page.on("pageerror", (err) => track.write("page.error", { message: err.message }));
  page.on("crash", () => track.write("page.crash"));
  page.on("close", () => track.write("page.close"));
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (/\/(info|health)$|\/api\//.test(url)) track.write("request.failed", { url, error: req.failure()?.errorText });
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const urls = new Map<string, string>();
  cdp.on("Network.webSocketCreated", (e) => {
    urls.set(e.requestId, e.url);
    track.write("cdp.ws_created", { rid: e.requestId, url: e.url });
  });
  cdp.on("Network.webSocketHandshakeResponseReceived", (e) => {
    const headers = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), v]));
    track.write("cdp.ws_handshake", { rid: e.requestId, url: urls.get(e.requestId), status: e.response.status, ray: headers["cf-ray"] });
  });
  cdp.on("Network.webSocketFrameError", (e) => {
    track.write("cdp.ws_frame_error", { rid: e.requestId, url: urls.get(e.requestId), error: e.errorMessage });
  });
  cdp.on("Network.webSocketClosed", (e) => {
    track.write("cdp.ws_closed", { rid: e.requestId, url: urls.get(e.requestId) });
    urls.delete(e.requestId);
  });
}

async function instrument(context: BrowserContext, track: Tracker, config: PageScriptConfig): Promise<void> {
  await context.exposeBinding("__soakEmit", (_source, event: Fields) => {
    const { type, ...rest } = event;
    if (typeof rest.text === "string") rest.text = redact(rest.text);
    track.write(String(type), rest);
  });
  await context.addInitScript(soakPageScript, config);
}

function inviteLink(group: Group): string {
  if (!group.invite) return group.host;
  return `https://app.gryt.chat/invite?${new URLSearchParams({ host: group.host, code: group.invite })}`;
}

export interface UiState {
  inVoice: boolean;
  banner: string | null;
  videos: { total: number; drawing: number };
}

export interface CallClient {
  who: string;
  group: Group;
  track: Tracker;
  page: Page;
  name: string;
  /** Back in the call when it has fallen out: the harness calls this after a minute outside. */
  rejoin(): Promise<void>;
  /** What the window shows: in the call or not, the server banner if one is up, and how many videos are drawing. */
  ui(): Promise<UiState>;
  close(leave: boolean): Promise<void>;
}

/** One Chromium of its own, joined to the group's server and its voice channel, camera on if asked. */
export async function startCallClient(who: string, group: Group, track: Tracker, appUrl: string, camera: boolean): Promise<CallClient> {
  const name = uniqueName(`Soak${group.name[0].toUpperCase()}`);
  const browser: Browser = await chromium.launch({ args: BROWSER_ARGS });
  browser.on("disconnected", () => track.write("browser.disconnected"));
  try {
    return await joinCall(who, group, track, appUrl, camera, browser, name);
  } catch (err) {
    await browser.close().catch(() => undefined);
    throw err;
  }
}

async function joinCall(
  who: string,
  group: Group,
  track: Tracker,
  appUrl: string,
  camera: boolean,
  browser: Browser,
  name: string,
): Promise<CallClient> {
  const context = await browser.newContext({
    baseURL: appUrl,
    viewport: { width: 1280, height: 800 },
    permissions: ["microphone", "camera"],
  });
  await instrument(context, track, { rewrite: group.rewrite, statsIntervalMs: STATS_INTERVAL_MS });
  await prepare(context, (problem) => track.write("harness.problem", { problem }), { nickname: name, allowHosts: [group.host] });
  // Wraps the soak script's RTCPeerConnection, so both see every connection whichever runs first.
  await watchPeerConnections(context, group.hideLocal);

  const page = await context.newPage();
  await wirePage(page, track);
  track.write("harness.start", { name, host: group.host, hideLocal: group.hideLocal, rewrite: group.rewrite });
  await page.goto("/");
  await joinServer(page, inviteLink(group));
  track.write("harness.joined_server", { name });

  const enterCall = async () => {
    await enterVoice(page, name);
    if (camera) await cameraOn(page);
    track.write("harness.in_call", { name, camera });
  };
  await enterCall();

  return {
    who,
    group,
    track,
    page,
    name,
    rejoin: async () => {
      track.write("harness.rejoin", { name });
      if (!(await channelComposer(page).isVisible().catch(() => false))) {
        await page.reload();
        await expect(channelComposer(page)).toBeVisible({ timeout: 60_000 });
      }
      await enterCall();
    },
    ui: async () => {
      const inVoice = (await leaveVoiceButton(page).count()) > 0;
      const banner = page.getByText(/^(Reconnecting to server\.\.\.|Server is unreachable)$/).first();
      // A tile is drawing when its video has a frame. A placeholder tile has no video at all.
      const videos = await page.evaluate(() => {
        const all = [...document.querySelectorAll("video")];
        return { total: all.length, drawing: all.filter((v) => v.videoWidth > 0 && v.readyState >= 2).length };
      });
      return { inVoice, banner: (await banner.count()) ? await banner.textContent() : null, videos };
    },
    close: async (leave: boolean) => {
      try {
        if (leave) {
          await leaveCall(page);
          await leaveServer(page, group.host);
          track.write("harness.left", { name });
        }
      } catch (err) {
        track.write("harness.leave_failed", { name, error: (err as Error).message });
      } finally {
        await browser.close().catch(() => undefined);
      }
    },
  };
}

/** The nightly's joinVoice without opening the panel, which a second joiner sometimes finds collapsed. */
async function enterVoice(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: VOICE_CHANNEL, exact: true }).click();
  await expect(leaveVoiceButton(page), `${name} never got into ${VOICE_CHANNEL}`).toBeAttached();
  await expect.poll(() => connectedPeers(page), `${name} never connected to the SFU`).toBeGreaterThan(0);
}

/** Pressed through the DOM, so a collapsed panel over the buttons doesn't matter. */
async function press(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).first().evaluate((button: HTMLElement) => button.click());
}

async function cameraOn(page: Page): Promise<void> {
  await press(page, "Turn camera on");
  await expect(page.getByRole("button", { name: "Start Camera" }), "the camera preview never got a stream").toBeEnabled();
  await press(page, "Start Camera");
  await expect(page.getByRole("button", { name: "Turn camera off" })).toBeAttached();
}

async function leaveCall(page: Page): Promise<void> {
  if ((await leaveVoiceButton(page).count()) === 0) return;
  await press(page, "Leave voice channel");
  await expect(leaveVoiceButton(page)).toHaveCount(0);
}

/** Off the server, so test.gryt.chat doesn't keep a member per run. The owner of a local server can't leave. */
async function leaveServer(page: Page, host: string): Promise<void> {
  if (!(await channelComposer(page).isVisible())) return;
  await page.getByRole("button", { name: "Server menu" }).click();
  await page.getByRole("menuitem", { name: "Leave server" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave server" }).click();
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(page.getByText(new RegExp(`^Left ${escaped}$|You own this server`))).toBeVisible();
}

export interface ProbeTarget {
  group: string;
  httpBase: string;
  sfu: string | null;
}

/**
 * A page on the app's origin that holds a bare socket.io connection to each server and a raw
 * WebSocket to each SFU. It never joins, so it needs no invite.
 */
export async function startBrowserProbe(track: Tracker, appUrl: string, targets: ProbeTarget[]): Promise<{ close(): Promise<void> }> {
  const browser = await chromium.launch({ args: BROWSER_ARGS });
  browser.on("disconnected", () => track.write("browser.disconnected"));
  const close = () => browser.close().catch(() => undefined);
  try {
    // A page served by route() has no address of its own, so Chromium wants permission before it reaches loopback or the LAN.
    const context = await browser.newContext({ baseURL: appUrl, permissions: ["local-network-access"] });
    await instrument(context, track, { rewrite: [], statsIntervalMs: STATS_INTERVAL_MS });

    const socketIo = createRequire(import.meta.url).resolve("socket.io-client/dist/socket.io.js");
    await context.route("**/__soak/socket.io.js", (route) => route.fulfill({ path: socketIo, contentType: "text/javascript" }));
    const body = `<!doctype html><title>soak probe</title><script src="/__soak/socket.io.js"></script><script>
      const targets = ${JSON.stringify(targets)};
      for (const t of targets) {
        io(t.httpBase, { transports: ["websocket"], reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
        if (!t.sfu) continue;
        const open = () => { const ws = new WebSocket(t.sfu.replace(/\\/$/, "") + "/client"); ws.onclose = () => setTimeout(open, 2000); };
        open();
      }
    </script>`;
    await context.route("**/__soak/probe.html", (route) => route.fulfill({ body, contentType: "text/html" }));

    const page = await context.newPage();
    await wirePage(page, track);
    await page.goto("/__soak/probe.html");
    track.write("harness.start", { targets });
    return { close };
  } catch (err) {
    await close();
    throw err;
  }
}
