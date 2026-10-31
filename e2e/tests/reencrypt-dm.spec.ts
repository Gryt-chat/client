import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Page } from "@playwright/test";

import { composer, membersPanel, messageRow, unique } from "../support/app";
import { expect, test } from "../support/fixtures";

const run = promisify(execFile);
const OLD_DATE = "2024-03-12T10:00:00.000Z";

async function sql<T>(container: string, script: string, ...args: string[]): Promise<T> {
  const js = `const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/data/gryt.db");const a=process.argv.slice(1);console.log(JSON.stringify((()=>{${script}})()??null))`;
  const { stdout } = await run("docker", ["exec", container, "node", "--no-warnings", "-e", js, ...args]);
  return JSON.parse(stdout.trim().split("\n").pop() as string) as T;
}

async function openFromList(page: Page, name: string) {
  const dms = page.getByRole("button", { name: "Direct messages" });
  // After a reload the rail draws before the server is connected, and a click then does nothing.
  await expect(async () => {
    await dms.click();
    await expect(dms).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name }).click();
  await expect(composer(page, `Message ${name}`)).toBeEditable();
}

async function say(page: Page, name: string, text: string) {
  const box = composer(page, `Message ${name}`);
  await box.click();
  await page.keyboard.insertText(text);
  await box.press("Enter");
  await expect(messageRow(page, text)).toBeVisible();
}

test("old plaintext moves by itself once the key has worked, keeps its sent date and shows when it arrived", async ({ newMember, freshServer }) => {
  test.setTimeout(180_000);
  const server = await freshServer({ instanceId: `reencrypt-${Date.now()}`, messageCacheTtlMs: 0 });
  const container = server.containerId as string;
  const alice = await newMember({ server, label: "alice" });
  const bob = await newMember({ server, label: "bob" });
  // Bob's DM only goes over MLS once his device exists.
  await expect.poll(() => bob.frames.some((f) => f.includes("mls:keypackages:publish")), { timeout: 30_000 }).toBe(true);
  await membersPanel(alice.page).getByRole("button", { name: bob.name, exact: true }).click();
  await alice.page.getByRole("button", { name: "Message", exact: true }).click();
  await expect(composer(alice.page, `Message ${bob.name}`)).toBeEditable();
  await say(alice.page, bob.name, unique("first"));
  await openFromList(bob.page, alice.name);

  const [{ conversation_id: dm }] = await sql<{ conversation_id: string }[]>(container, `return db.prepare("SELECT DISTINCT conversation_id FROM conversation_members WHERE conversation_id LIKE 'dm_%'").all()`);
  const id = async (name: string) => (await sql<{ server_user_id: string }>(container, `return db.prepare("SELECT server_user_id FROM users WHERE nickname=?").get(a[0])`, name)).server_user_id;
  const [aliceId, bobId] = [await id(alice.name), await id(bob.name)];
  const mine = unique("old mine");
  const reply = unique("old reply");
  const theirs = unique("old theirs");
  await sql(container, `const i=db.prepare("INSERT INTO messages (conversation_id,message_id,sender_server_id,text,created_at,reply_to_message_id) VALUES (?,?,?,?,?,?)");
    i.run(a[0],"p-mine",a[1],a[3],a[6],null);i.run(a[0],"p-reply",a[1],a[4],a[6],"p-mine");i.run(a[0],"p-reacted",a[1],a[7],"2023-06-02T10:00:00.000Z",null);db.prepare("UPDATE messages SET reactions=? WHERE message_id='p-reacted'").run(JSON.stringify([{src:"👍",amount:1,users:[a[2]]}]));i.run(a[0],"p-theirs",a[2],a[5],"2024-03-13T10:00:00.000Z","p-mine");`, dm, aliceId, bobId, mine, reply, theirs, OLD_DATE, unique("old reacted"));
  await alice.page.reload();
  await openFromList(alice.page, bob.name);

  // Nothing moves before a message from Bob has opened on this device.
  await expect(alice.page.getByText(mine).first()).toBeVisible();
  expect(alice.frames.some((f) => f.includes('"chat:delete"'))).toBe(false);

  await say(bob.page, alice.name, unique("hello"));
  await expect(alice.page.getByText("Encrypted 3 of your older messages")).toBeVisible({ timeout: 60_000 });

  const left = await sql<{ message_id: string }[]>(container, `return db.prepare("SELECT message_id FROM messages WHERE conversation_id=? AND message_id LIKE 'p-%' ORDER BY message_id").all(a[0])`, dm);
  expect(left.map((r) => r.message_id)).toEqual(["p-theirs"]);

  for (const member of [alice, bob]) {
    await expect(member.page.locator('[data-message-id="re-p-mine"]')).toContainText(mine);
    await expect(member.page.locator('[data-message-id="re-p-reply"]')).toContainText(reply);
    await expect(member.page.locator('[data-message-id="p-mine"]')).toHaveCount(0);
    await member.page.getByText("Mar 12, 2024", { exact: true }).first().hover();
    await expect(member.page.getByText(/^shared by/)).toHaveCount(0);
    const tip = member.page.getByText(/Server received this copy/);
    await expect(tip).toContainText("according to the sender");
    await expect(tip).toContainText("2024");
    await expect(tip).toContainText(String(new Date().getFullYear()));
  }
  await expect(messageRow(alice.page, theirs)).toContainText(mine);
  await expect(alice.page.locator('[data-message-id="re-p-reacted"]')).toContainText("👍");
});
