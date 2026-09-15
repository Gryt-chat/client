import { expectFramesDecoded, expectPlaying, joinVoice, tileVideo } from "./support/call";
import { expect, test } from "./support/fixtures";

test("a shared screen reaches the other guest as decoded frames", async ({ guest }) => {
  const alice = await guest();
  const bob = await guest();
  await joinVoice(alice);
  await joinVoice(bob);

  // In a browser the button calls getDisplayMedia straight away, and Chrome's fake capture answers it.
  await bob.page.getByRole("button", { name: "Share your screen" }).click();
  await expect(bob.page.getByRole("button", { name: "Stop sharing your screen" })).toBeVisible();

  await expectFramesDecoded(alice, `${bob.name}'s screen`);
  await expectPlaying(tileVideo(alice.page, `${bob.name}'s Screen`));

  await bob.page.getByRole("button", { name: "Stop sharing your screen" }).click();
  await expect(tileVideo(alice.page, `${bob.name}'s Screen`)).toHaveCount(0);
});
