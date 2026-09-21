import { existsSync, writeFileSync } from "node:fs";

import { test } from "@playwright/test";

import { type CallClient, startBrowserProbe, startCallClient } from "./support/clients";
import { readConfig } from "./support/config";
import { RunDir } from "./support/jsonl";
import { httpProbe, networkWatch, pingProbe, sfuProbe, socketProbe, type Stoppable } from "./support/probes";
import { Tracker } from "./support/tracker";

const config = readConfig();

/** A call that has been out of the voice channel this long gets put back in. */
const REJOIN_AFTER_MS = 60_000;
/** Joining now and then misses a step, and a fresh browser usually gets in. */
const START_ATTEMPTS = 3;
const CHECK_EVERY_MS = 10_000;
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
  harness.write("harness.config", { groups: summary, minutes: config.minutes, camera: config.camera, ping: config.ping });
  console.log(`Soak for ${config.minutes} minutes into ${run.dir}. Touch STOP there to end it early.`);

  const trackers: Tracker[] = [];
  const stoppers: Stoppable[] = [];
  const net = new Tracker(run.log("net"), "net");
  stoppers.push(networkWatch(net));
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
            clients.push(await startCallClient(who, group, track, appUrl, config.camera));
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
    let lastStatus = 0;

    while (Date.now() < deadline && !existsSync(run.path("STOP"))) {
      for (const client of clients) {
        const ui = await client.ui().catch(() => ({ inVoice: false, banner: "page unreachable" }));
        if (client.track.inVoice !== ui.inVoice) client.track.write("ui.voice", { inVoice: ui.inVoice });
        client.track.inVoice = ui.inVoice;
        if (ui.banner) client.track.write("ui.banner", { text: ui.banner });

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
