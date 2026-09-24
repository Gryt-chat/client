import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { BrowserContext, Locator, Page, WebSocketRoute } from "@playwright/test";

import { channelComposer, composer, joinServer, type Member, membersPanel, sendMessage, unique } from "../support/app";
import { expect, test } from "../support/fixtures";
import type { GrytServer } from "../support/server";

/* A message sent across a server restart goes out once it is back, and once. Written but
   unechoed, lost on the way, sent while down, and sent before the restore (GRYT-1453). */

const run = promisify(execFile);
const softly = expect.configure({ soft: true });

/** Everything between alice's page and the server, with the four things these tests do to it. */
interface Wire {
  /** The next chat:send never reaches the server, as if it went into a socket already dead. */
  loseNextSend: boolean;
  /** The next chat:send's echo is swallowed, as if the server died before sending it. */
  swallowNextEcho: boolean;
  swallowed: Set<string>;
  /** How the test knows the server wrote the message. */
  echoesSwallowed: number;
  /** session:restore is held back, so the socket stays unidentified. */
  holdRestore: boolean;
  heldRestores: { to: WebSocketRoute; message: string | Buffer }[];
  /** Every nonce the page sent, so a row still carrying one as its id reads as unconfirmed. */
  nonces: Set<string>;
  sendsDelivered: number;
  open: number;
}

async function tapWire(context: BrowserContext, server: GrytServer): Promise<Wire> {
  const port = new URL(server.httpBase).port;
  const wire: Wire = {
    loseNextSend: false,
    swallowNextEcho: false,
    swallowed: new Set(),
    echoesSwallowed: 0,
    holdRestore: false,
    heldRestores: [],
    nonces: new Set(),
    sendsDelivered: 0,
    open: 0,
  };
  await context.routeWebSocket(
    (url) => url.port === port && url.pathname.startsWith("/socket.io/"),
    (page) => {
      const toServer = page.connectToServer();
      wire.open++;
      toServer.onClose(() => {
        wire.open--;
        void page.close();
      });
      page.onMessage((message) => {
        const text = message.toString();
        if (text.startsWith('42["chat:send",')) {
          const nonce = (JSON.parse(text.slice(2))[1] as { nonce?: string }).nonce ?? "";
          wire.nonces.add(nonce);
          if (wire.swallowNextEcho) {
            wire.swallowNextEcho = false;
            wire.swallowed.add(nonce);
          }
          if (wire.loseNextSend) {
            wire.loseNextSend = false;
            return;
          }
          wire.sendsDelivered++;
        }
        if (wire.holdRestore && text.startsWith('42["session:restore",')) {
          wire.heldRestores.push({ to: toServer, message });
          return;
        }
        toServer.send(message);
      });
      toServer.onMessage((message) => {
        const text = message.toString();
        const swallow = text.startsWith('42["chat:new",') && [...wire.swallowed].find((nonce) => text.includes(nonce));
        if (swallow) {
          // Only the first: a resend's echo is the one that should get through.
          wire.swallowed.delete(swallow);
          wire.echoesSwallowed++;
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

interface Conversation {
  box: Locator;
  /** Every row carrying this text, pending, failed or confirmed. */
  rows: (text: string) => Locator;
  /** Back to the same conversation after a reload. */
  reopen: () => Promise<void>;
}

function channel(page: Page): Conversation {
  return {
    box: channelComposer(page),
    rows: (text) => page.locator("[data-message-id]").filter({ hasText: text }),
    reopen: () => expect(channelComposer(page)).toBeVisible(),
  };
}

async function dm(alice: Member, bob: Member): Promise<Conversation> {
  const box = composer(alice.page, `Message ${bob.name}`);
  await membersPanel(alice.page).getByRole("button", { name: bob.name, exact: true }).click();
  await expect(box).toBeVisible();
  return {
    box,
    rows: (text) => alice.page.locator("[data-message-id]").filter({ hasText: text }),
    reopen: () => expect(box).toBeVisible(),
  };
}

async function thread(page: Page): Promise<Conversation> {
  const root = unique("a thread across a restart");
  await sendMessage(page, root);
  const panel = page.getByRole("complementary", { name: "Thread" });
  const open = async (name: "Start thread" | "Open thread") => {
    const row = page.locator('[data-message-id]:not([data-message-id^="pending-"])').filter({ hasText: root }).first();
    await row.hover();
    await row.getByRole("button", { name }).click();
    await expect(panel).toBeVisible();
  };
  await open("Start thread");
  return {
    box: composer(page, "Reply to thread…"),
    rows: (text) => panel.locator("[data-message-id]").filter({ hasText: text }),
    reopen: () => open("Open thread"),
  };
}

async function type(page: Page, box: Locator, text: string): Promise<void> {
  await box.click();
  await page.keyboard.insertText(text);
  await box.press("Enter");
  await expect(box).toHaveText("");
}

/** What each row's id says: still the page's own, failed, or the server's. */
async function rowStates(rows: Locator, nonces: Set<string>): Promise<string[]> {
  const seen = await rows.evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute("data-message-id") ?? "", failed: !!el.textContent?.includes("Failed to send") })),
  );
  return seen.map(({ id, failed }) =>
    failed ? "failed" : id.startsWith("pending-") || nonces.has(id) ? "pending" : "sent",
  );
}

for (const kind of ["channel", "dm", "thread"] as const) {
  test(`a ${kind} message sent across a server restart goes out once`, async ({ newMember, freshServer }) => {
    test.setTimeout(180_000);
    const server = await freshServer({ instanceId: `restart-${kind}-${Date.now()}` });
    const container = server.containerId;
    if (!container) throw new Error("This test restarts the server's container, so it needs one.");

    // Routed before the first socket opens, so the one open at the kill is tapped too. The
    // route is a script in the page, so it needs a load after it to take.
    const alice = await newMember({ server, join: false, label: "alice" });
    const wire = await tapWire(alice.context, server);
    await alice.page.reload();
    await joinServer(alice.page, server.host);
    const bob = kind === "dm" ? await newMember({ server, label: "bob" }) : null;

    const conversation =
      kind === "channel" ? channel(alice.page) : kind === "dm" ? await dm(alice, bob!) : await thread(alice.page);

    // Here before the restart, so a first page rebuilt after it has to carry it.
    const before = unique("said before the restart");
    await type(alice.page, conversation.box, before);
    await expect.poll(() => rowStates(conversation.rows(before), wire.nonces)).toEqual(["sent"]);
    const [probeId] = await conversation.rows(before).evaluateAll((els) => els.map((el) => el.getAttribute("data-message-id")));
    /* A resend is only safe on a server that derives the id from the nonce, which
       makes it a version 5 uuid. This turns itself on once server:latest carries it. */
    test.skip(!/^[0-9a-f]{8}-[0-9a-f]{4}-5/.test(probeId ?? ""), "this server image does not dedupe a resend across a restart (GRYT-1453)");

    // Written by the server, but its echo never reached the page before the server died.
    const unacked = unique("written but never echoed");
    wire.swallowNextEcho = true;
    await type(alice.page, conversation.box, unacked);
    await expect.poll(() => wire.echoesSwallowed, { message: "the server should have written it" }).toBe(1);

    // Into a socket that is already dead but has not said so yet.
    const lost = unique("lost on the way");
    wire.loseNextSend = true;
    await type(alice.page, conversation.box, lost);
    await expect.poll(() => wire.loseNextSend, { message: "the page should have sent it" }).toBe(false);

    await run("docker", ["kill", container]);
    await expect.poll(() => wire.open, { message: "the page should have lost its socket" }).toBe(0);

    const whileDown = unique("sent while the server was down");
    await type(alice.page, conversation.box, whileDown);
    await expect(conversation.rows(whileDown)).toHaveCount(1);

    wire.holdRestore = true;
    await run("docker", ["start", container]);
    await expect.poll(() => healthy(server), { timeout: 60_000 }).toBe(true);
    await expect
      .poll(() => wire.heldRestores.length, { message: "the page should reconnect and ask to be restored", timeout: 60_000 })
      .toBeGreaterThan(0);

    // On a socket that is back but has not said who it is yet.
    const beforeRestore = unique("sent before the session was restored");
    const sendsBefore = wire.sendsDelivered;
    await type(alice.page, conversation.box, beforeRestore);
    await expect(conversation.rows(beforeRestore)).toHaveCount(1);
    // Either it went out unidentified, or the page is holding it until the restore.
    await expect
      .poll(async () => wire.sendsDelivered > sendsBefore || (await conversation.rows(beforeRestore).getAttribute("data-send-state")) === "waiting")
      .toBe(true);

    wire.holdRestore = false;
    for (const { to, message } of wire.heldRestores.splice(0)) to.send(message);

    const texts = [unacked, lost, whileDown, beforeRestore];
    for (const text of texts) {
      await softly
        .poll(() => rowStates(conversation.rows(text), wire.nonces), { message: `"${text}" on alice's screen`, timeout: 45_000 })
        .toEqual(["sent"]);
    }

    // A DM typed while the socket had no id used to go out in the clear.
    if (kind === "dm") {
      for (const text of texts) {
        await expect.soft(conversation.rows(text).filter({ hasText: "Not encrypted" }), `"${text}" sealed`).toHaveCount(0);
      }
    }

    // What the server holds, read back fresh: each message once, in the order it was typed.
    await alice.page.reload();
    await conversation.reopen();
    for (const text of [before, ...texts]) {
      await expect.soft(conversation.rows(text), `"${text}" on the server`).toHaveCount(1);
    }
    const order = await alice.page
      .locator("[data-message-id]")
      .evaluateAll((els, wanted) => els.map((el) => wanted.find((t) => el.textContent?.includes(t))).filter(Boolean), texts);
    expect.soft([...new Set(order)], "in the order they were typed").toEqual(texts);
  });
}
