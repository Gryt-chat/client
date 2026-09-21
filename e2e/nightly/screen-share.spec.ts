import {
  announcedStreams,
  expectFramesDecoded,
  expectPlaying,
  focusTile,
  joinVoice,
  playedStream,
  shareScreen,
  stopSharing,
  tileVideo,
  unfocusTile,
} from "./support/call";
import { expect, test } from "./support/fixtures";

test("a shared screen reaches the other guest, and a second one keeps playing while the sharer focuses a tile", async ({
  guest,
}) => {
  const alice = await guest();
  const bob = await guest();
  await joinVoice(alice);
  await joinVoice(bob);

  await shareScreen(bob);
  const screen = tileVideo(alice.page, `${bob.name}'s Screen`);
  await expectFramesDecoded(alice, `${bob.name}'s screen`);
  await expectPlaying(screen);
  const stream = await playedStream(screen);

  await stopSharing(bob);
  await expect(screen).toHaveCount(0);

  // GRYT-1319: a second share goes out on the first one's sender, under its stream id. Focusing
  // a tile mounts the call controls again, and they announce the share again.
  await shareScreen(bob);
  await expectPlaying(screen);
  await focusTile(bob.page, "Your Screen");
  await expectPlaying(screen, 1);
  await unfocusTile(bob.page);
  await expectPlaying(screen, 1);
  expect(announcedStreams(bob, "voice:screen:state", "videoStreamId"), `${alice.name} plays ${stream}`).toEqual([stream]);

  await stopSharing(bob);
  await expect(screen).toHaveCount(0);
});
