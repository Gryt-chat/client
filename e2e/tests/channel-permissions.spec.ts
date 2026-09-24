import { accessTokenOf, ask, withSocket } from "../support/admin";
import { channelComposer, messageRow, sendMessage, sidebarChannelRow, unique } from "../support/app";
import { expect, test, uniqueName } from "../support/fixtures";

/** A channel's denies take their buttons away there only. An older server sends no
    per-channel list (GRYT-1416), and the client falls back to the server-wide one. */

const DENIED = ["add_reactions", "attach_files"];

test("a channel's denies take its buttons away there and nowhere else", async ({ owner, newMember, gryt }) => {
  const { host, httpBase } = gryt.server;
  const accessToken = await accessTokenOf(owner.page, host);

  const suffix = uniqueName("");
  const quiet = uniqueName("quiet");
  const quietId = `chan-quiet${suffix}`;
  const open = uniqueName("open");
  const openId = `chan-open${suffix}`;

  await withSocket(httpBase, async (socket) => {
    for (const [channelId, name] of [[quietId, quiet], [openId, open]] as const) {
      socket.emit("server:channels:upsert", { accessToken, channelId, name, type: "text", description: null });
      await expect(sidebarChannelRow(owner.page, name)).toBeVisible();
    }
    // Both roles, since which one a guest lands on is the server's default to pick.
    const rules = ["guest", "member"].flatMap((roleId) =>
      DENIED.map((permission) => ({ roleId, permission, effect: "deny" })),
    );
    socket.emit("server:channels:scope:set", { accessToken, channelId: quietId, custom: true, rules });
    await expect.poll(async () => {
      const scope = await ask<{ rules?: unknown[] }>(
        socket, "server:channels:scope:get", { accessToken, channelId: quietId }, "server:channels:scope",
      );
      return scope.rules?.length ?? 0;
    }, "the channel's rules should be saved before anybody joins").toBe(rules.length);
  });

  // Something in each channel to hover over.
  const said = { [quiet]: unique("in quiet"), [open]: unique("in open") };
  for (const name of [quiet, open]) {
    await sidebarChannelRow(owner.page, name).click();
    await sendMessage(owner.page, said[name], name);
  }

  const member = await newMember();
  await expect(sidebarChannelRow(member.page, quiet)).toBeVisible();
  const perChannel = member.frames.some((f) => f.includes("\"myPermissions\""));

  const buttonsIn = async (name: string) => {
    await sidebarChannelRow(member.page, name).click();
    await expect(channelComposer(member.page, name)).toBeVisible();
    const row = messageRow(member.page, said[name]);
    await row.hover();
    // Reply is on every row the member can see, so the toolbar is up once it is.
    await expect(member.page.getByRole("button", { name: "Reply" }).first()).toBeVisible();
    return {
      react: member.page.getByRole("button", { name: "React with another emoji" }),
      attach: member.page.getByRole("button", { name: "Attach file" }),
    };
  };

  const inOpen = await buttonsIn(open);
  await expect(inOpen.react).toBeVisible();
  await expect(inOpen.attach).toBeVisible();

  const inQuiet = await buttonsIn(quiet);
  if (perChannel) {
    await expect(inQuiet.react).toHaveCount(0);
    await expect(inQuiet.attach).toHaveCount(0);
  } else {
    // The server-wide list allows both, so an older server keeps drawing them.
    await expect(inQuiet.react).toBeVisible();
    await expect(inQuiet.attach).toBeVisible();
  }
  test.info().annotations.push({
    type: "server",
    description: perChannel ? "sends per-channel permissions" : "older server: server-wide fallback",
  });
});
