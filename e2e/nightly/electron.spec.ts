import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

import { channelComposer, joinServer, membersPanel } from "../support/app";
import { prepare, uniqueName } from "../support/fixtures";
import { CLIENT_ROOT } from "../support/preview";
import { ProblemLog } from "../support/problems";
import { freePort } from "../support/server";
import { isAlive, isDescendantOf, listeners, occupy } from "./support/ports";

/** The electron package's main export is the path to its binary. It throws when the download was skipped. */
const electronBinary = () => createRequire(import.meta.url)("electron") as string;

/** The SFU's own registration and metrics ports. A second app on the machine finds them taken by the first. */
const SFU_DEFAULT_LOCAL_PORTS = [9092, 9091];

interface HostedServer {
  id: string;
  status: string;
  config: { serverPort: number; sfuPort: number; mediaPort: number; controlPort: number; metricsPort: number };
}

type ElectronApi = {
  getEmbeddedServerStatus(): Promise<HostedServer[]>;
  getEmbeddedServerLogs(id?: string): Promise<{ source: string; text: string }[]>;
};

function hostedServers(desktop: Page): Promise<HostedServer[]> {
  return desktop.evaluate(() => (window as unknown as { electronAPI: ElectronApi }).electronAPI.getEmbeddedServerStatus());
}

async function createServer(desktop: Page, name: string, port: number): Promise<void> {
  await desktop.getByRole("button", { name: "Add a server" }).first().click();
  await desktop.getByRole("dialog", { name: "Add a server" }).getByRole("button", { name: /^Create my own/ }).click();

  const form = desktop.getByRole("dialog", { name: "Create your server" });
  await form.getByPlaceholder("My Server").fill(name);
  await form.getByPlaceholder("5000").fill(String(port));
  await expect(form.getByText("Available", { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "Create", exact: true }).click();

  await expect(form, "the server never started").toBeHidden({ timeout: 120_000 });
  await expect(channelComposer(desktop)).toBeVisible();
}

async function createInvite(settings: Locator, code: string): Promise<void> {
  await settings.getByRole("tab", { name: "Invites", exact: true }).click();
  const panel = settings.getByRole("tabpanel", { name: "Invites" });
  await panel.getByPlaceholder("Leave blank for random").fill(code);
  await panel.getByRole("button", { name: "Create invite" }).click();
  await expect(panel.getByText(code, { exact: true })).toBeVisible();
}

test("the desktop app hosts a server on an SFU of its own, and a browser joins it", async ({ browser }, testInfo) => {
  test.skip(
    process.platform === "darwin" && !process.env.GRYT_E2E_ELECTRON_ON_MAC,
    "On macOS the app asks for camera access every time it starts, until Electron has an answer in System Settings",
  );

  const problems = new ProblemLog();
  const userData = await mkdtemp(join(tmpdir(), "gryt-nightly-"));
  const decoys = await occupy(SFU_DEFAULT_LOCAL_PORTS);
  const serverPort = await freePort();
  const serverName = uniqueName("Nightly");
  let app: ElectronApplication | null = null;
  let desktop: Page | null = null;
  let sfuPid = 0;

  try {
    app = await electron.launch({ executablePath: electronBinary(), args: [CLIENT_ROOT, `--user-data-dir=${userData}`] });
    await app.context().tracing.start({ screenshots: true, snapshots: true });
    // The desktop app keeps its nickname in the main process, so the one seeded here goes unused.
    await prepare(app.context(), problems.report, { nickname: uniqueName("Host") });
    desktop = await app.firstWindow();
    // The window can load before the init scripts are in, so start it again from empty storage.
    await desktop.waitForLoadState("domcontentloaded");
    await desktop.evaluate(() => localStorage.clear());
    await desktop.reload();
    await expect.poll(() => desktop!.evaluate(() => localStorage.getItem("gryt.hasSeenWelcome"))).toBe("true");

    await createServer(desktop, serverName, serverPort);
    // Only from here: the socket dials the server while it boots and logs each refused attempt.
    problems.watch(desktop, "desktop app", `http://127.0.0.1:${serverPort}`);

    // A new server asks its owner to set it up, which is also where invites are made.
    const settings = desktop.getByRole("dialog", { name: "Server settings" });
    await expect(settings).toBeVisible();
    const code = `nightly${Date.now()}`;
    await createInvite(settings, code);
    await desktop.keyboard.press("Escape");
    await expect(settings).toBeHidden();

    // Manage server is only on the rail entry of a server this app runs.
    await desktop.getByRole("button", { name: serverName, exact: true }).click({ button: "right" });
    await expect(desktop.getByRole("menuitem", { name: "Manage server" })).toBeVisible();
    await desktop.keyboard.press("Escape");

    const [hosted] = await hostedServers(desktop);
    expect(hosted?.status, "the app doesn't list the server as running").toBe("running");
    const { config } = hosted;
    const held = {
      signalling: await listeners(config.sfuPort, "TCP"),
      registration: await listeners(config.controlPort, "TCP"),
      metrics: await listeners(config.metricsPort, "TCP"),
      media: await listeners(config.mediaPort, "UDP"),
    };
    await testInfo.attach("sfu-ports.json", { body: JSON.stringify({ config, held }, null, 2), contentType: "application/json" });

    expect(Object.values(held).every((found) => found.length > 0), "one of the SFU's ports has nothing on it").toBe(true);
    const pids = new Set(Object.values(held).flatMap((found) => found.map((l) => l.pid)));
    expect([...pids], "the SFU's ports belong to more than one process").toHaveLength(1);
    [sfuPid] = pids;
    expect(await isDescendantOf(sfuPid, app.process().pid!), "whatever holds the SFU's ports isn't this app's").toBe(true);
    expect(SFU_DEFAULT_LOCAL_PORTS, "the SFU's registration port is one somebody else holds").not.toContain(config.controlPort);
    expect(held.registration.map((l) => l.address), "registration answers beyond this machine").toEqual([
      `127.0.0.1:${config.controlPort}`,
    ]);

    const guestName = uniqueName("Guest");
    const context = await browser.newContext();
    await prepare(context, problems.report, { nickname: guestName });
    const guest = await context.newPage();
    problems.watch(guest, "browser guest", `http://127.0.0.1:${serverPort}`);
    await guest.goto("/");
    await joinServer(guest, `gryt://invite?host=127.0.0.1:${serverPort}&code=${code}`);
    await expect(membersPanel(desktop), "the app never saw the guest arrive").toContainText(guestName);
    const owner = (page: Page) => membersPanel(page).getByRole("region", { name: /^owner/i });
    await expect(owner(guest), "the guest sees somebody else owning the server").toHaveText((await owner(desktop).textContent())!);
    await context.close();
  } catch (err) {
    if (app) {
      await app.context().tracing.stop({ path: testInfo.outputPath("electron-trace.zip") }).catch(() => undefined);
      await testInfo.attach("electron-trace", { path: testInfo.outputPath("electron-trace.zip") }).catch(() => undefined);
    }
    const logs = await desktop
      ?.evaluate(() => (window as unknown as { electronAPI: ElectronApi }).electronAPI.getEmbeddedServerLogs())
      .catch(() => []);
    if (logs?.length) {
      await testInfo.attach("embedded-server.log", { body: logs.map((l) => `[${l.source}] ${l.text}`).join("\n") });
    }
    const startup = await readFile(join(userData, "gryt-startup.log"), "utf8").catch(() => "");
    if (startup) await testInfo.attach("gryt-startup.log", { body: startup });
    throw err;
  } finally {
    await app?.close().catch(() => undefined);
    await decoys.release();
    await rm(userData, { recursive: true, force: true });
  }

  if (sfuPid) await expect.poll(() => isAlive(sfuPid), `the SFU (pid ${sfuPid}) outlived the app`).toBe(false);
  problems.assertClean();
});
