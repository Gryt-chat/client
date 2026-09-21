import {
  announcedStreams,
  expectAudioArriving,
  expectFramesDecoded,
  expectPlaying,
  expectSfuAddress,
  focusTile,
  joinVoice,
  playedStream,
  tileVideo,
  turnCameraOn,
  unfocusTile,
} from "./support/call";
import { expect, test } from "./support/fixtures";

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

// GRYT-1251: a replacement camera track keeps the original WebRTC stream/MSID.
// GRYT-1319: focusing a tile mounts the call controls again, and they announce the camera again.
test("GRYT-1251: the other guest's tile plays the camera, and still does while the sender focuses a tile", async ({
  guest,
}) => {
  const alice = await guest();
  const bob = await guest();
  await joinVoice(alice);
  await joinVoice(bob);

  await turnCameraOn(alice);
  const camera = tileVideo(bob.page, alice.name);
  await expectPlaying(camera);
  const stream = await playedStream(camera);

  await focusTile(alice.page, alice.name);
  await expectPlaying(camera, 1);
  await unfocusTile(alice.page);
  await expectPlaying(camera, 1);
  expect(announcedStreams(alice, "voice:camera:state", "streamId"), `${bob.name} plays ${stream}`).toEqual([stream]);
});
