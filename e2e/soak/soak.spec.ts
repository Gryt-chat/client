import { existsSync, writeFileSync } from "node:fs";

import { test } from "@playwright/test";

import { type CallClient, startBrowserProbe, startCallClient } from "./support/clients";
import { readConfig } from "./support/config";
import { RunDir } from "./support/jsonl";
import { httpProbe, networkWatch, pingProbe, routeWatch, sfuProbe, socketProbe, type Stoppable } from "./support/probes";
import { Tracker } from "./support/tracker";

const config = readConfig();

/** A call that has been out of the voice channel this long gets put back in. */
const REJOIN_AFTER_MS = 60_000;
/** Joining now and then misses a step, and a fresh browser usually gets in. */
const START_ATTEMPTS = 3;
const CHECK_EVERY_MS = Number(process.env.GRYT_SOAK_CHECK_SECONDS || 10) * 1000;
const STATUS_EVERY_MS = 60_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
}

test("soak", async () => {
  test.setTimeout((config.minutes + 30) * 60_000);
  const appUrl = process.env.GRYT_E2E_APP_URL;
  if (!appUrl) throw new Error("GRYT_E2E_APP_URL is unset; run this through e2e/soak/playwright.config.ts.");

  const run = new RunDir(config.out);
  const harness = new Tracker(run.log("harness"), "harness");
  const summary = config.groups.map(({ invite, ...group }) => ({ ...group, invite: invite ? "set" : null }));
  writeFileSync(run.path("config.json"), `${JSON.stringify({ ...config, groups: summary, appUrl }, null, 2)}\n`);
  harness.write("harness.config", { groups: summary, minutes: config.minutes, camera: config.camera, ping: config.ping, beepMs: config.beepMs });
  console.log(`Soak for ${config.minutes} minutes into ${run.dir}. Touch STOP there to end it early.`);

  const trackers: Tracker[] = [];
  const stoppers: Stoppable[] = [];
  const net = new Tracker(run.log("net"), "net");
  stoppers.push(networkWatch(net), routeWatch(net));
  for (const host of config.ping) stoppers.push(pingProbe(net, host));

  for (const group of config.groups) {
    const node = new Tracker(run.log(`node-${group.name}`), `node-${group.name}`);
    trackers.push(node);
    stoppers.push(socketProbe(node, group.httpBase), httpProbe(node, group.httpBase));
    if (group.sfu) stoppers.push(sfuProbe(node, group.sfu));
  }

  let browserProbe: { close(): Promise<void> } | null = null;
  const clients: CallClient[] = [];
  try {
    if (config.browserProbe) {
      const track = new Tracker(run.log("browser-probe"), "browser-probe");
      trackers.push(track);
      const targets = config.groups.map((g) => ({ group: g.name, httpBase: g.httpBase, sfu: g.sfu }));
      browserProbe = await startBrowserProbe(track, appUrl, targets);
    }

    for (const group of config.groups) {
      for (let i = 1; i <= group.clients; i++) {
        const who = `${group.name}-${i}`;
        const track = new Tracker(run.log(who), who);
        trackers.push(track);
        for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
          try {
            const beep = config.beepMs ? { send: clients.length === 0, periodMs: config.beepMs, echo: process.env.GRYT_SOAK_ECHO === "1" } : null;
            clients.push(await startCallClient(who, group, track, appUrl, config.camera, beep));
            break;
          } catch (err) {
            track.write("harness.start_failed", { attempt, error: (err as Error).message.slice(0, 2000) });
            console.log(`${who} could not join (attempt ${attempt}): ${(err as Error).message.split("\n")[0]}`);
          }
        }
      }
    }
    if (config.groups.some((g) => g.clients > 0) && clients.length === 0) throw new Error("No call client got into the call.");

    const started = Date.now();
    const deadline = started + config.minutes * 60_000;
    const outsideSince = new Map<CallClient, number>();
    const lastVideos = new Map<CallClient, string>();
    let lastStatus = 0;
    // GRYT_SOAK_MUTE_SECONDS: the beeper mutes 30 s in for this long. A beep heard in between is a leak.
    // With GRYT_SOAK_PTT=1 it's in push to talk and holds V for that window instead: heard only then.
    const ptt = process.env.GRYT_SOAK_PTT === "1";
    // GRYT_SOAK_SWITCH_MIC=1: the beeper picks another microphone 30 s in. Beeps after it mean the voice followed.
    let switchMic = process.env.GRYT_SOAK_SWITCH_MIC === "1" && config.beepMs !== null && clients.length > 0;
    const muteMs = Number(process.env.GRYT_SOAK_MUTE_SECONDS || 0) * 1000;
    let muteStep: "muted" | "unmuted" | null = muteMs > 0 && config.beepMs && clients[0] ? null : "unmuted";

    while (Date.now() < deadline && !existsSync(run.path("STOP"))) {
      for (const client of clients) {
        const ui = await client.ui().catch(() => ({ inVoice: false, banner: "page unreachable", videos: { total: 0, drawing: 0 } }));
        if (client.track.inVoice !== ui.inVoice) client.track.write("ui.voice", { inVoice: ui.inVoice });
        client.track.inVoice = ui.inVoice;
        if (ui.banner) client.track.write("ui.banner", { text: ui.banner });
        const videos = `${ui.videos.drawing}/${ui.videos.total}`;
        if (lastVideos.get(client) !== videos) client.track.write("ui.videos", ui.videos);
        lastVideos.set(client, videos);

        if (ui.inVoice) {
          outsideSince.delete(client);
          continue;
        }
        const since = outsideSince.get(client) ?? Date.now();
        outsideSince.set(client, since);
        if (Date.now() - since < REJOIN_AFTER_MS) continue;
        try {
          await client.rejoin();
          outsideSince.delete(client);
        } catch (err) {
          client.track.write("harness.rejoin_failed", { error: (err as Error).message.slice(0, 500) });
          outsideSince.set(client, Date.now());
        }
      }

      const into = Date.now() - started;
      if (muteStep !== "unmuted" && into >= 30_000 + (muteStep === "muted" ? muteMs : 0)) {
        const { page } = clients[0];
        if (ptt) {
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          await (muteStep === "muted" ? page.keyboard.up("KeyV") : page.keyboard.down("KeyV"));
        } else {
          const label = muteStep === "muted" ? "Unmute microphone" : "Mute microphone";
          await page.getByRole("button", { name: label }).first().click();
        }
        muteStep = muteStep === "muted" ? "unmuted" : "muted";
        harness.write(`harness.${muteStep}`, { who: clients[0].who, ptt });
      }

      if (switchMic && into >= 30_000) {
        switchMic = false;
        const { page } = clients[0];
        await page.locator('[data-tour="profile"]').click();
        await page.locator('[data-tour="menu-settings"]').click();
        const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
        await dialog.getByRole("button", { name: "Voice & video" }).click();
        await dialog.getByRole("button", { name: "Audio", exact: true }).click();
        const picker = dialog.getByText("Microphone", { exact: true }).locator("xpath=../..").getByRole("combobox");
        const from = await picker.textContent();
        await picker.click();
        await page.getByRole("option").filter({ hasNotText: from ?? "" }).first().click();
        const to = await picker.textContent();
        await page.keyboard.press("Escape");
        harness.write("harness.mic_switched", { who: clients[0].who, from, to });
      }

      if (Date.now() - lastStatus >= STATUS_EVERY_MS) {
        lastStatus = Date.now();
        const lines = [
          `${new Date().toISOString()}  ${elapsed(Date.now() - started)} of ${elapsed(config.minutes * 60_000)}`,
          ...trackers.map((t) => t.status()),
        ];
        writeFileSync(run.path("status.txt"), `${lines.join("\n")}\n`);
        harness.write("harness.status", { lines });
      }
      await wait(CHECK_EVERY_MS);
    }
    harness.write("harness.done", { stoppedEarly: existsSync(run.path("STOP")) });
  } finally {
    // Guests leave test.gryt.chat when done. A local server's first guest owns it and can't.
    await Promise.all(clients.map((client) => client.close(client.group.name !== "local")));
    await browserProbe?.close();
    for (const stopper of stoppers) stopper.stop();
    harness.write("harness.end");
    await run.close();
  }
});
