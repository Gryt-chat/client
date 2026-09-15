import {
  expectAudioArriving,
  expectFramesDecoded,
  expectPlaying,
  expectSfuAddress,
  joinVoice,
  tileVideo,
  turnCameraOn,
} from "./support/call";
import { test } from "./support/fixtures";

test("two guests hear each other through the SFU's public address, and a camera gets through", async ({
  guest,
  server,
}) => {
  const alice = await guest();
  const bob = await guest();
  await joinVoice(alice);
  await joinVoice(bob);

  for (const member of [alice, bob]) {
    await expectAudioArriving(member);
    await expectSfuAddress(member, server);
  }

  await turnCameraOn(alice);
  await expectFramesDecoded(bob, `${alice.name}'s camera`);
});

// GRYT-1251: the camera restarts as it starts, and the tile waits for a stream id nobody sends.
test.fixme("GRYT-1251: the other guest's tile plays the camera", async ({ guest }) => {
  const alice = await guest();
  const bob = await guest();
  await joinVoice(alice);
  await joinVoice(bob);

  await turnCameraOn(alice);
  await expectPlaying(tileVideo(bob.page, alice.name));
});
