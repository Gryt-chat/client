import {
  announcedStreams,
  expectAudioArriving,
  expectFramesDecoded,
  expectPlaying,
  expectSfuAddress,
  focusTile,
  type Guest,
  joinVoice,
  playedStream,
  shareScreen,
  stopSharing,
  tileVideo,
  turnCameraOff,
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

/** Alice's camera and screen as Bob sees them, and the stream ids his tiles played. */
function watch(alice: Guest, bob: Guest) {
  const camera = tileVideo(bob.page, alice.name);
  const screen = tileVideo(bob.page, `${alice.name}'s Screen`);
  const played = { camera: [] as (string | null)[], screen: [] as (string | null)[] };
  return {
    camera,
    screen,
    played,
    async cameraOn(forSeconds = 0) {
      await turnCameraOn(alice);
      await expectPlaying(camera, forSeconds);
      played.camera.push(await playedStream(camera));
    },
    async cameraOff() {
      await turnCameraOff(alice);
      await expect(camera).toHaveCount(0);
    },
    async share(forSeconds = 0) {
      await shareScreen(alice);
      await expectPlaying(screen, forSeconds);
      played.screen.push(await playedStream(screen));
    },
    async stopShare() {
      await stopSharing(alice);
      await expect(screen).toHaveCount(0);
    },
    /** Every id Alice announced is one Bob's tiles played. */
    expectAnnouncedPlayed() {
      expect(announcedStreams(alice, "voice:camera:state", "streamId")).toEqual([...new Set(played.camera)]);
      expect(announcedStreams(alice, "voice:screen:state", "videoStreamId")).toEqual([...new Set(played.screen)]);
    },
  };
}

// GRYT-1329: the SFU offers each guest two video slots. A camera turned off and on again used to take
// the screen's, so the share that followed never arrived.
test("GRYT-1329: a camera turned off and on again leaves room for a screen share, two rounds over", async ({
  guest,
}) => {
  const alice = await guest();
  const bob = await guest();
  await joinVoice(alice);
  await joinVoice(bob);
  const call = watch(alice, bob);

  for (let round = 1; round <= 2; round++) {
    await call.cameraOn();
    await call.cameraOff();
    await call.cameraOn(1);
    await call.share(1);
    await expectPlaying(call.camera, 1);

    await call.stopShare();
    await call.cameraOff();
  }
  call.expectAnnouncedPlayed();
});

// The same in the other order: with the screen on the first slot, the camera coming back had none left.
test("GRYT-1329: a camera turned off and on again during a screen share still gets through, two rounds over", async ({
  guest,
}) => {
  const alice = await guest();
  const bob = await guest();
  await joinVoice(alice);
  await joinVoice(bob);
  const call = watch(alice, bob);

  for (let round = 1; round <= 2; round++) {
    await call.share();
    await call.cameraOn();
    await call.cameraOff();
    await call.cameraOn(1);
    await expectPlaying(call.screen, 1);

    await call.stopShare();
    await call.cameraOff();
  }
  call.expectAnnouncedPlayed();
});
