#!/usr/bin/env node
/**
 * One press of an update button lands on the newest release: a newer one replaces the
 * download it would have installed, at the press or in the background (GRYT-1213).
 */

import assert from "node:assert/strict";

import { createPendingUpdate } from "../electron/pendingUpdate.ts";
import { nextShown } from "../src/components/updateToastState.ts";
import { CHECKS, PRESSES } from "./lib/updateEntryPoints.mjs";

let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

const release = (version) => ({ tag: `v${version}`, version });

/*
 * Stands in for electron-updater the way main.ts drives it, with one download slot like the real
 * one. `setting.automatic` is the Automatic updates switch, which a test can flip between offers.
 */
function harness({ waitForStaging = false, findNewer = async () => null, automatic = true } = {}) {
  const jobs = [];
  const lookups = [];
  const timers = [];
  const reports = [];
  const setting = { automatic };
  const state = { installs: 0, overlaps: 0, busy: false };

  const updates = createPendingUpdate({
    startDownload(rel, options) {
      if (state.busy) state.overlaps += 1;
      const job = { release: rel, options, cancelled: false };
      job.check = new Promise((resolve, reject) => {
        job.resolveCheck = resolve;
        job.rejectCheck = reject;
      });
      jobs.push(job);
      return job.check;
    },
    findNewer(floor) {
      lookups.push(floor);
      return findNewer(floor);
    },
    install() {
      state.installs += 1;
    },
    automatic() {
      return setting.automatic;
    },
    report(rel) {
      reports.push(rel);
    },
    waitForStaging,
    lookupTimeoutMs: 5000,
    log() {},
    setTimeout(run, ms) {
      timers.push({ run, ms });
    },
  });

  /* update-available, then the check resolves with the download it started. */
  function begin(job, version = job.release.version) {
    const announced = updates.available(version);
    let settle;
    const download = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    state.busy = true;
    const free = () => {
      state.busy = false;
    };

    job.announced = announced;
    job.cancellationToken = {
      cancel() {
        job.cancelled = true;
      },
    };
    /* The cancelled request unwinds later, and only then is the slot free. */
    job.settleCancelled = () => {
      free();
      settle.reject(new Error("cancelled"));
    };
    job.land = () => {
      const next = updates.downloaded(version);
      free();
      settle.resolve([]);
      return next;
    };
    job.failDownload = () => {
      const outcome = updates.failed();
      free();
      settle.reject(new Error("net::ERR_CONNECTION_RESET"));
      return outcome;
    };

    job.resolveCheck({ downloadPromise: download, cancellationToken: job.cancellationToken });
    return announced;
  }

  /* The check itself failed, before any download began: an error event, then the rejection. */
  function failCheck(job) {
    const outcome = updates.failed();
    job.rejectCheck(new Error("HttpError: 404"));
    return outcome;
  }

  /* Held back by the rollout slice: update-not-available, then a result with no download. */
  function holdBack(job) {
    const outcome = updates.notAvailable();
    job.resolveCheck({ downloadPromise: null });
    return outcome;
  }

  async function downloadAndLand(version, options = { announce: true }) {
    assert.equal(updates.offer(release(version), options), "downloading", `offer ${version}`);
    await flush();
    const job = jobs.at(-1);
    assert.equal(job.release.version, version);
    begin(job);
    await flush();
    job.land();
    await flush();
    return job;
  }

  const fireTimers = () => timers.splice(0).forEach((timer) => timer.run());

  return { updates, jobs, lookups, reports, setting, state, begin, failCheck, holdBack, downloadAndLand, fireTimers };
}

console.log("update supersede");

/* ── At the press ───────────────────────────────────────────────────── */

await check("a stale download is replaced at the press, and the newer one installs without a second press", async () => {
  const h = harness({ findNewer: async () => release("1.11.22") });
  await h.downloadAndLand("1.11.21");
  assert.equal(h.updates.ready(), "1.11.21");

  assert.equal(h.updates.requestInstall(), "looking");
  await flush();

  assert.deepEqual(h.lookups, ["1.11.21"], "the lookup starts from what is downloaded");
  assert.equal(h.state.installs, 0, "the stale 1.11.21 must not install");
  assert.equal(h.jobs.length, 2);
  assert.deepEqual(h.jobs[1].release, release("1.11.22"));
  assert.equal(h.jobs[1].options.bypassRollout, true);
  assert.equal(h.jobs[1].options.installWhenReady, true);

  const announced = h.begin(h.jobs[1]);
  assert.deepEqual(announced, { announce: true, installWhenReady: true });
  assert.equal(h.updates.ready(), null, "1.11.21 is gone once 1.11.22 starts");
  assert.equal(h.updates.held().version, "1.11.22");

  await flush();
  assert.equal(h.jobs[1].land(), "installing");
  assert.equal(h.state.installs, 1);
  assert.equal(h.updates.ready(), "1.11.22");
  assert.equal(h.state.overlaps, 0);
});

await check("a lookup that fails installs what is downloaded", async () => {
  const h = harness({
    findNewer: async () => {
      throw new Error("fetch failed");
    },
  });
  await h.downloadAndLand("1.11.21");

  h.updates.requestInstall();
  await flush();

  assert.equal(h.state.installs, 1);
  assert.equal(h.jobs.length, 1, "nothing else is fetched");
  assert.equal(h.updates.ready(), "1.11.21");
});

await check("a lookup that never answers installs what is downloaded once the timeout passes", async () => {
  const h = harness({ findNewer: () => new Promise(() => {}) });
  await h.downloadAndLand("1.11.21");

  h.updates.requestInstall();
  await flush();
  assert.equal(h.state.installs, 0, "not before the timeout");
  assert.equal(h.updates.installPending(), true);

  h.fireTimers();
  await flush();
  assert.equal(h.state.installs, 1);
  assert.equal(h.jobs.length, 1);
});

await check("a lookup that answers after the timeout changes nothing", async () => {
  let answer;
  const h = harness({ findNewer: () => new Promise((resolve) => (answer = resolve)) });
  await h.downloadAndLand("1.11.21");

  h.updates.requestInstall();
  h.fireTimers();
  await flush();
  answer(release("1.11.22"));
  await flush();

  assert.equal(h.state.installs, 1);
  assert.equal(h.jobs.length, 1, "the install already went ahead");
});

await check("the same version is not downloaded again, and installs straight away", async () => {
  const h = harness({ findNewer: async () => release("1.11.21") });
  await h.downloadAndLand("1.11.21");

  assert.equal(h.updates.offer(release("1.11.21"), { announce: true }), "ignored");
  assert.equal(h.updates.offer(release("1.11.20"), { announce: true }), "ignored");

  h.updates.requestInstall();
  await flush();

  assert.equal(h.jobs.length, 1);
  assert.equal(h.state.installs, 1);
});

await check("the newer release's check failing before its download installs the older one", async () => {
  const h = harness({ findNewer: async () => release("1.11.22") });
  await h.downloadAndLand("1.11.21");

  h.updates.requestInstall();
  await flush();

  assert.deepEqual(h.failCheck(h.jobs[1]), { kind: "installing" });
  await flush();
  assert.equal(h.state.installs, 1);
  assert.equal(h.updates.ready(), "1.11.21");
});

await check("the newer release held back by the rollout installs the older one", async () => {
  const h = harness({ findNewer: async () => release("1.11.22") });
  await h.downloadAndLand("1.11.21");

  h.updates.requestInstall();
  await flush();

  assert.deepEqual(h.holdBack(h.jobs[1]), { kind: "installing" });
  await flush();
  assert.equal(h.state.installs, 1);
  assert.equal(h.updates.ready(), "1.11.21");
});

await check("the newer download failing part way installs nothing and loops nowhere", async () => {
  const h = harness({ findNewer: async () => release("1.11.22") });
  await h.downloadAndLand("1.11.21");

  h.updates.requestInstall();
  await flush();
  h.begin(h.jobs[1]);
  await flush();

  assert.deepEqual(h.jobs[1].failDownload(), { kind: "none", announced: true });
  await flush();

  assert.equal(h.state.installs, 0, "1.11.21 was cleared when 1.11.22 began");
  assert.equal(h.updates.held(), null);
  assert.equal(h.jobs.length, 2, "nothing retries by itself");
});

await check("a second press while looking looks once", async () => {
  const h = harness({ findNewer: () => new Promise(() => {}) });
  await h.downloadAndLand("1.11.21");

  assert.equal(h.updates.requestInstall(), "looking");
  assert.equal(h.updates.requestInstall(), "looking");
  assert.equal(h.lookups.length, 1);
});

await check("with nothing downloaded, a press says so rather than install", async () => {
  const h = harness();
  assert.equal(h.updates.requestInstall(), "nothing");
  assert.equal(h.state.installs, 0);
});

await check("a press during a download installs it once it lands", async () => {
  const h = harness();
  h.updates.offer(release("1.11.21"), { announce: true });
  await flush();
  h.begin(h.jobs[0]);

  assert.equal(h.updates.requestInstall(), "downloading");
  assert.equal(h.updates.held().installWhenReady, true);
  assert.equal(h.state.installs, 0);

  assert.equal(h.jobs[0].land(), "installing");
  assert.equal(h.state.installs, 1);
});

/* ── In the background ──────────────────────────────────────────────── */

await check("a newer release during a download cancels it, and starts only once the slot is free", async () => {
  const h = harness();
  h.updates.offer(release("1.11.21"), { announce: true });
  await flush();
  h.begin(h.jobs[0]);
  await flush();

  assert.equal(h.updates.offer(release("1.11.22"), { announce: true }), "downloading");
  await flush();

  assert.equal(h.jobs[0].cancelled, true, "the stale download is cancelled");
  assert.equal(h.jobs.length, 1, "electron-updater would hand the old download back");
  assert.equal(h.updates.held().version, "1.11.22");

  h.jobs[0].settleCancelled();
  await flush();

  assert.equal(h.jobs.length, 2);
  assert.deepEqual(h.jobs[1].release, release("1.11.22"));
  assert.deepEqual(h.begin(h.jobs[1]), { announce: true, installWhenReady: false });
  await flush();
  assert.equal(h.jobs[1].land(), "ready");
  assert.equal(h.updates.ready(), "1.11.22");
  assert.equal(h.state.installs, 0, "nobody pressed install");
  assert.equal(h.state.overlaps, 0);
});

await check("a newer release before the check answers cancels the download as it starts", async () => {
  const h = harness();
  h.updates.offer(release("1.11.21"), { announce: true });
  await flush();

  h.updates.offer(release("1.11.22"), { announce: true });
  await flush();
  assert.equal(h.jobs.length, 1);

  h.begin(h.jobs[0]);
  await flush();
  assert.equal(h.jobs[0].cancelled, true);

  h.jobs[0].settleCancelled();
  await flush();
  assert.equal(h.jobs.length, 2);
  assert.equal(h.jobs[1].release.version, "1.11.22");
});

await check("a download that lands as it is replaced is still replaced", async () => {
  const h = harness();
  h.updates.offer(release("1.11.21"), { announce: true });
  await flush();
  h.begin(h.jobs[0]);
  await flush();

  h.updates.offer(release("1.11.22"), { announce: true });
  h.jobs[0].land();
  await flush();

  assert.equal(h.updates.ready(), null, "1.11.22 is on its way");
  assert.equal(h.jobs.length, 2);
  h.begin(h.jobs[1]);
  await flush();
  h.jobs[1].land();
  assert.equal(h.updates.ready(), "1.11.22");
  assert.equal(h.state.overlaps, 0);
});

await check("a newer release replaces a finished download that is waiting", async () => {
  const h = harness();
  await h.downloadAndLand("1.11.21");

  assert.equal(h.updates.offer(release("1.11.22"), { announce: true }), "downloading");
  await flush();
  assert.equal(h.jobs.length, 2);

  h.begin(h.jobs[1]);
  assert.equal(h.updates.ready(), null);
  await flush();
  h.jobs[1].land();
  assert.equal(h.updates.ready(), "1.11.22");
});

await check("a pressed install carries over to the release that replaces the download", async () => {
  const h = harness();
  h.updates.offer(release("1.11.21"), { announce: true });
  await flush();
  h.begin(h.jobs[0]);
  h.updates.requestInstall();

  h.updates.offer(release("1.11.22"), { announce: true });
  await flush();
  h.jobs[0].settleCancelled();
  await flush();

  assert.equal(h.jobs[1].options.installWhenReady, true);
  h.begin(h.jobs[1]);
  await flush();
  h.jobs[1].land();
  assert.equal(h.state.installs, 1);
});

await check("a background check whose newer release fails keeps the download it had", async () => {
  const h = harness();
  await h.downloadAndLand("1.11.21");

  h.updates.offer(release("1.11.22"), { announce: true });
  await flush();
  assert.deepEqual(h.failCheck(h.jobs[1]), { kind: "kept", version: "1.11.21" });
  await flush();

  assert.equal(h.updates.ready(), "1.11.21");
  assert.equal(h.state.installs, 0);
});


/* ── Automatic updates on and off (GRYT-1206, GRYT-1218) ────────────── */

for (const [name, { options }] of Object.entries(CHECKS)) {
  await check(`${name}, automatic updates on: the release downloads`, async () => {
    const h = harness({ automatic: true });
    assert.equal(h.updates.offer(release("1.11.22"), options), "downloading");
    await flush();

    assert.equal(h.jobs.length, 1);
    assert.deepEqual(h.jobs[0].options, { ...options, installWhenReady: false });
    assert.deepEqual(h.reports, []);
  });

  await check(`${name}, automatic updates off: the release is reported and nothing downloads`, async () => {
    const h = harness({ automatic: false });
    assert.equal(h.updates.offer(release("1.11.22"), options), "reported");
    await flush();

    assert.equal(h.jobs.length, 0, "nothing may reach the updater");
    assert.deepEqual(h.reports, [release("1.11.22")]);
    assert.equal(h.updates.held(), null);
    assert.deepEqual(h.updates.reported(), release("1.11.22"));
  });
}

for (const [name, { options }] of Object.entries(PRESSES)) {
  for (const automatic of [true, false]) {
    await check(`${name}, automatic updates ${automatic ? "on" : "off"}: the press downloads`, async () => {
      const h = harness({ automatic });
      assert.equal(h.updates.offer(release("1.11.22"), options), "downloading");
      await flush();

      assert.equal(h.jobs.length, 1);
      assert.equal(h.jobs[0].options.bypassRollout, true);
      assert.deepEqual(h.reports, []);
      h.begin(h.jobs[0]);
      await flush();
      assert.equal(h.jobs[0].land(), "ready");
      assert.equal(h.updates.ready(), "1.11.22");
    });
  }
}

await check("the switch is read at each offer, so turning it off holds from the next check", async () => {
  const h = harness({ automatic: true });
  await h.downloadAndLand("1.11.21", CHECKS["Gryt started at login"].options);

  h.setting.automatic = false;
  assert.equal(h.updates.offer(release("1.11.22"), { announce: true }), "reported");
  await flush();
  assert.equal(h.jobs.length, 1);
  assert.equal(h.updates.ready(), "1.11.21", "a report keeps the download that is there");

  h.setting.automatic = true;
  assert.equal(h.updates.offer(release("1.11.22"), { announce: true }), "downloading");
  await flush();
  assert.equal(h.jobs.length, 2);
});

await check("a report after a pressed download leaves that download ready to install", async () => {
  const h = harness({ automatic: false });
  await h.downloadAndLand("1.11.21", PRESSES["download now, or install with nothing downloaded"].options);

  assert.equal(h.updates.offer(release("1.11.22"), CHECKS["Check for Updates in Settings"].options), "reported");
  assert.equal(h.updates.offer(release("1.11.21"), { announce: true }), "ignored", "not reported twice");
  await flush();

  assert.deepEqual(h.reports, [release("1.11.22")]);
  assert.equal(h.updates.ready(), "1.11.21");
  assert.equal(h.jobs.length, 1);
});

for (const automatic of [true, false]) {
  await check(`install finds a newer release, automatic updates ${automatic ? "on" : "off"}: it downloads and installs`, async () => {
    const h = harness({ automatic, findNewer: async () => release("1.11.22") });
    await h.downloadAndLand("1.11.21", PRESSES["download now, or install with nothing downloaded"].options);

    assert.equal(h.updates.requestInstall(), "looking");
    await flush();

    assert.deepEqual(h.reports, [], "the press is the ask, so nothing is only reported");
    assert.equal(h.state.installs, 0, "the stale 1.11.21 must not install");
    assert.equal(h.jobs.length, 2);
    assert.equal(h.jobs[1].options.asked, true);
    assert.equal(h.jobs[1].options.installWhenReady, true);

    h.begin(h.jobs[1]);
    await flush();
    assert.equal(h.jobs[1].land(), "installing");
    assert.equal(h.state.installs, 1);
    assert.equal(h.updates.ready(), "1.11.22");
  });
}

await check("a press can take the release a check reported, when the probe finds nothing newer", async () => {
  const h = harness({ automatic: false });

  /* Leaving beta pins an older stable, which the probe's floor never lets through. */
  h.updates.offer(release("1.11.20"), CHECKS["Check for Updates in Settings"].options);
  const pressed = h.updates.reported();
  assert.deepEqual(pressed, release("1.11.20"));

  assert.equal(h.updates.offer(pressed, PRESSES["download now, or install with nothing downloaded"].options), "downloading");
  await flush();
  assert.equal(h.jobs.length, 1);
  assert.equal(h.jobs[0].release.version, "1.11.20");
});

/* ── macOS ──────────────────────────────────────────────────────────── */

await check("macOS waits for Squirrel to stage the newer download before installing", async () => {
  const h = harness({ waitForStaging: true, findNewer: async () => release("1.11.22") });
  await h.downloadAndLand("1.11.21");
  h.updates.staged(true);

  h.updates.requestInstall();
  await flush();
  h.begin(h.jobs[1]);
  await flush();

  assert.equal(h.jobs[1].land(), "installing");
  assert.equal(h.state.installs, 0, "Squirrel still holds 1.11.21 and would install that");

  h.updates.staged(true);
  assert.equal(h.state.installs, 1);
});

await check("macOS gives up an install when Squirrel cannot stage the download", async () => {
  const h = harness({ waitForStaging: true });
  await h.downloadAndLand("1.11.21");

  h.updates.requestInstall();
  h.fireTimers();
  await flush();
  assert.equal(h.updates.installPending(), true);

  h.updates.failed();
  h.updates.staged(false);
  assert.equal(h.state.installs, 0);
  assert.equal(h.updates.ready(), null);
  assert.equal(h.updates.installPending(), false);
});

/* ── The toast ──────────────────────────────────────────────────────── */

const play = (statuses, start = null) =>
  statuses.reduce(
    (shown, status) => {
      const next = nextShown(shown.current, status);
      return next ? { current: next, renders: [...shown.renders, next] } : shown;
    },
    { current: start, renders: [] },
  );

await check("the toast follows a newer release in place, from the press to the install", () => {
  const { current, renders } = play([
    { status: "announced", version: "1.11.21", autoDownload: true },
    { status: "downloading", version: "1.11.21", percent: 50 },
    { status: "downloaded", version: "1.11.21" },
    { status: "installing", version: "1.11.21" },
    { status: "checking" },
    { status: "announced", version: "1.11.22", autoDownload: true, reannounce: true, installWhenReady: true },
    { status: "downloading", version: "1.11.22", percent: 30 },
    { status: "installing", version: "1.11.22" },
  ]);

  assert.deepEqual(
    renders.map((shown) => `${shown.version} ${shown.phase}${shown.newerAfterPress ? " newer" : ""}`),
    [
      "1.11.21 downloading",
      "1.11.21 downloading",
      "1.11.21 ready",
      "1.11.21 installing",
      "1.11.22 downloading newer",
      "1.11.22 downloading newer",
      "1.11.22 installing newer",
    ],
  );
  assert.equal(current.percent, undefined);
});

await check("a press during a download installs that same release, and the toast does not call it newer", () => {
  const { current } = play([
    { status: "announced", version: "1.11.21", autoDownload: true },
    { status: "downloading", version: "1.11.21", percent: 40 },
    { status: "announced", version: "1.11.21", autoDownload: true, reannounce: true, installWhenReady: true },
  ]);
  assert.equal(current.version, "1.11.21");
  assert.equal(current.newerAfterPress, false);

  const replayed = nextShown(
    { version: "1.11.22", phase: "downloading", newerAfterPress: true },
    { status: "announced", version: "1.11.22", autoDownload: true, reannounce: true, installWhenReady: true },
  );
  assert.equal(replayed.newerAfterPress, true, "a replay of the same release keeps saying so");
});

await check("a dismissed toast stays down for its own release and comes back for a newer one", () => {
  const up = play([{ status: "announced", version: "1.11.21", autoDownload: true }]).current;
  up.dismissed = true;

  assert.equal(nextShown(up, { status: "downloading", version: "1.11.21", percent: 10 }), null);
  assert.equal(nextShown(up, { status: "announced", version: "1.11.21", autoDownload: true }), null);

  const newer = nextShown(up, { status: "announced", version: "1.11.22", autoDownload: true });
  assert.equal(newer.version, "1.11.22");
  assert.equal(newer.dismissed, undefined);
});

await check("progress for a replacement renames the toast rather than keep the old version", () => {
  const up = play([
    { status: "announced", version: "1.11.21", autoDownload: false },
    { status: "downloading", version: "1.11.22", percent: 5 },
  ]).current;
  assert.equal(up.version, "1.11.22");
  assert.equal(up.phase, "downloading");
});

await check("a reported release offers the download, and the same toast follows it once pressed", () => {
  const { renders } = play([
    { status: "announced", version: "1.11.25", from: "1.11.24", autoDownload: false },
    { status: "available", version: "1.11.25" },
    { status: "downloading", version: "1.11.25", percent: 10 },
    { status: "downloaded", version: "1.11.25" },
  ]);

  assert.deepEqual(renders.map((shown) => shown.phase), ["waiting", "downloading", "ready"]);
});

await check("asking again redraws a dismissed report with its button, not a bar", () => {
  const up = play([{ status: "announced", version: "1.11.25", autoDownload: false }]).current;
  up.dismissed = true;

  const again = nextShown(up, { status: "announced", version: "1.11.25", autoDownload: false, reannounce: true });
  assert.equal(again.phase, "waiting");
});

await check("statuses with no toast up raise nothing", () => {
  for (const status of ["downloading", "downloaded", "installing", "error", "checking"]) {
    assert.equal(nextShown(null, { status, version: "1.11.22" }), null, status);
  }
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}

console.log("\nupdate supersede checks passed");
