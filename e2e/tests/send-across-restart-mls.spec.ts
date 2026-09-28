import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { BrowserContext, Locator, Page } from "@playwright/test";

import { composer, joinServer, type Member, membersPanel, messageRow, unique } from "../support/app";
import { expect, test } from "../support/fixtures";
import type { GrytServer } from "../support/server";

/* An MLS DM across a server restart goes out once: unacked or lost, then typed while down.
   A send with no answer holds up the next one in its DM, so each run has one of those. */

const run = promisify(execFile);

/* What Chrome logs for a redial while the server is down or still booting. Allowed only
   between the kill and the moment every message is through. */
const REDIAL_FAILED = /^WebSocket connection to 'ws:\/\/[^']+' failed: (Connection closed before receiving a handshake response|Error in connection establishment: net::ERR_[A-Z_]+|Error during WebSocket handshake: net::ERR_[A-Z_]+)$/;
const softly = expect.configure({ soft: true });

/** Alice's socket, with the two things these tests do to an `mls:send`. */
interface Wire {
  /** The next mls:send is written, and its ack never reaches the page. */
  swallowNextAck: boolean;
  acksSwallowed: number;
  /** The next mls:send never reaches the server, as if it went into a socket already dead. */
  loseNextSend: boolean;
  sendsLost: number;
  mlsSends: number;
  open: number;
}

async function tapWire(context: BrowserContext, server: GrytServer): Promise<Wire> {
  const port = new URL(server.httpBase).port;
  const wire: Wire = { swallowNextAck: false, acksSwallowed: 0, loseNextSend: false, sendsLost: 0, mlsSends: 0, open: 0 };
  await context.routeWebSocket(
    (url) => url.port === port && url.pathname.startsWith("/socket.io/"),
    (page) => {
      const toServer = page.connectToServer();
      wire.open++;
      toServer.onClose(() => {
        wire.open--;
        void page.close();
      });
      const swallowAcks = new Set<string>();
      // A binary event is a text frame saying how many binary frames follow it.
      let dropBinary = 0;
      page.onMessage((message) => {
        if (typeof message !== "string") {
          if (dropBinary > 0) {
            dropBinary--;
            return;
          }
          toServer.send(message);
          return;
        }
        const send = /^45(\d+)-(\d+)\["mls:send"/.exec(message);
        if (send) {
          wire.mlsSends++;
          if (wire.swallowNextAck) {
            wire.swallowNextAck = false;
            swallowAcks.add(send[2]);
          }
          if (wire.loseNextSend) {
            wire.loseNextSend = false;
            wire.sendsLost++;
            dropBinary = Number(send[1]);
            return;
          }
        }
        toServer.send(message);
      });
      toServer.onMessage((message) => {
        const ack = typeof message === "string" ? /^43(\d+)\[/.exec(message) : null;
        if (ack && swallowAcks.delete(ack[1])) {
          wire.acksSwallowed++;
          return;
        }
        page.send(message);
      });
    },
  );
  return wire;
}

async function healthy(server: GrytServer): Promise<boolean> {
  try {
    return (await fetch(`${server.httpBase}/health`)).ok;
  } catch {
    return false;
  }
}

async function openDm(from: Member, to: Member): Promise<Locator> {
  const box = composer(from.page, `Message ${to.name}`);
  await membersPanel(from.page).getByRole("button", { name: to.name, exact: true }).click();
  // Drawn before the DM knows how to send, and read-only until it does.
  await expect(from.page.getByText("This conversation is encrypted.")).toBeVisible();
  await expect(box).toBeEditable();
  return box;
}

async function type(page: Page, box: Locator, text: string): Promise<void> {
  await box.focus();
  await page.keyboard.insertText(text);
  await expect(box).toHaveText(text);
  await box.press("Enter");
  await expect(box).toHaveText("");
}

/** Each row carrying this text: waiting, pending, failed, or sent. */
async function rowStates(page: Page, text: string): Promise<string[]> {
  return page
    .locator("[data-message-id]")
    .filter({ hasText: text })
    .evaluateAll((els) =>
      els.map((el) => {
        const state = el.getAttribute("data-send-state");
        if (state) return state;
        return el.getAttribute("data-message-id")?.startsWith("pending-") ? "pending" : "sent";
      }),
    );
}

for (const kind of ["unacked", "lost"] as const) {
  test(`an MLS DM ${kind === "unacked" ? "written but never acked" : "lost on the way"} as the server dies goes out once`, async ({ newMember, freshServer, problems }) => {
    test.setTimeout(180_000);
    const server = await freshServer({ instanceId: `restart-mls-${kind}-${Date.now()}` });
    const container = server.containerId;
    if (!container) throw new Error("This test restarts the server's container, so it needs one.");

    // Routed before the first socket opens, so the one open at the kill is tapped too.
    const alice = await newMember({ server, join: false, label: "alice" });
    const wire = await tapWire(alice.context, server);
    await alice.page.reload();
    await joinServer(alice.page, server.host);
    const bob = await newMember({ server, label: "bob" });

    const box = await openDm(alice, bob);
    const before = unique("said over MLS before the restart");
    await type(alice.page, box, before);
    await expect.poll(() => rowStates(alice.page, before)).toEqual(["sent"]);
    expect(wire.mlsSends, "the DM should be on MLS").toBeGreaterThan(0);
    await bob.page.getByRole("button", { name: "Direct messages" }).click();
    await bob.page.getByRole("button", { name: alice.name }).click();
    await expect(messageRow(bob.page, before)).toBeVisible();

    const unanswered = unique(kind === "unacked" ? "written but never acked" : "lost on the way");
    if (kind === "unacked") {
      // Written by the server, and its ack never reached the page before the server died.
      wire.swallowNextAck = true;
      await type(alice.page, box, unanswered);
      await expect.poll(() => wire.acksSwallowed, { message: "the server should have answered it" }).toBe(1);
    } else {
      // Into a socket that is already dead but hasn't said so yet.
      wire.loseNextSend = true;
      await type(alice.page, box, unanswered);
      await expect.poll(() => wire.sendsLost, { message: "the page should have sent it" }).toBe(1);
    }

    const stopTolerating = problems.tolerate([REDIAL_FAILED]);
    await run("docker", ["kill", container]);
    await expect.poll(() => wire.open, { message: "the page should have lost its socket" }).toBe(0);

    const whileDown = unique("typed while the server was down");
    await type(alice.page, box, whileDown);
    for (const text of [unanswered, whileDown]) {
      await softly.poll(() => rowStates(alice.page, text), { message: `"${text}" waits` }).toEqual(["waiting"]);
    }

    await run("docker", ["start", container]);
    await expect.poll(() => healthy(server), { timeout: 60_000 }).toBe(true);

    const texts = [unanswered, whileDown];
    for (const text of texts) {
      await softly
        .poll(() => rowStates(alice.page, text), { message: `"${text}" on alice's screen`, timeout: 60_000 })
        .toEqual(["sent"]);
    }
    for (const text of texts) {
      await softly.poll(() => messageRow(bob.page, text).count(), { message: `"${text}" on bob's screen`, timeout: 30_000 }).toBe(1);
    }
    stopTolerating();

    // Bob's copy, read back from his archive: each message once, in the order it was typed.
    await bob.page.reload();
    await bob.page.getByRole("button", { name: "Direct messages" }).click();
    await bob.page.getByRole("button", { name: alice.name }).click();
    for (const text of [before, ...texts]) await expect.soft(messageRow(bob.page, text), `"${text}" once for bob`).toHaveCount(1);
    const order = await bob.page
      .locator("[data-message-id]")
      .evaluateAll((els, wanted) => els.map((el) => wanted.find((t) => el.textContent?.includes(t))).filter(Boolean), texts);
    expect.soft([...new Set(order)], "in the order they were typed").toEqual(texts);
    await expect(bob.page.getByText("couldn't be decrypted")).toHaveCount(0);
  });
}
