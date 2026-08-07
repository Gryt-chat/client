/**
 * Fake voice participants, for looking at the grid at counts we cannot reach.
 *
 * The server allows one voice connection per user — a second tab is kicked with
 * "Device Switch Detected" — so the only way to see a three-, five- or
 * seven-person grid on a dev box with one account is to invent the extra
 * people. This injects them into the real `clients` record, so the real
 * VoiceView renders them through the real providers with the real CSS. What it
 * does not do is exercise the socket path that would normally populate that
 * record, so it proves the layout and nothing about the plumbing.
 *
 * Dev only, off unless asked for by query string:
 *
 *   ?fake=7              seven fake participants alongside you
 *   ?fake=4&fakeshare=1  ...one of whom is sharing a screen
 *   ?fake=4&fakemuted=2  ...of whom the first two are muted
 *
 * The screen share is a real MediaStream off a canvas, not a placeholder, so
 * the tile takes the same code path a real share does — <video> element,
 * object-fit contain, the lot.
 */
import type { Client } from "../types/clients";

const FAKE_PREFIX = "fake-";

const NAMES = [
  "Ada",
  "Bjørn",
  "Chidi",
  "Dagny",
  "Emeka",
  "Freja",
  "Goro",
  "Hanne",
  "Iker",
  "Jinhee",
  "Kwame",
  "Liv",
];

export interface FakeParticipantOptions {
  count: number;
  muted: number;
  share: boolean;
}

/** Parsed once — the options come from the URL and do not change under us. */
export function readFakeParticipantOptions(
  search: string,
): FakeParticipantOptions | null {
  if (!import.meta.env.DEV) return null;

  const params = new URLSearchParams(search);
  const count = Number(params.get("fake"));

  if (!Number.isInteger(count) || count < 1 || count > NAMES.length) return null;

  return {
    count,
    muted: Math.min(Number(params.get("fakemuted")) || 0, count),
    share: params.get("fakeshare") === "1",
  };
}

let screenStream: MediaStream | null = null;

/**
 * A moving canvas as a stand-in for a shared screen.
 *
 * It has to move: a canvas that is never drawn to produces a track that stays
 * in "live" but delivers no frames, and the tile then sits on its pending
 * state forever, which looks exactly like a bug.
 */
function fakeScreenStream(): MediaStream {
  if (screenStream) return screenStream;

  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;

  const ctx = canvas.getContext("2d")!;
  let frame = 0;

  const draw = () => {
    frame++;
    ctx.fillStyle = "#12233a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#5b8def";
    ctx.fillRect((frame * 4) % canvas.width, 300, 180, 120);
    ctx.fillStyle = "#fff";
    ctx.font = "48px sans-serif";
    ctx.fillText(`fake screen share — frame ${frame}`, 60, 120);
    requestAnimationFrame(draw);
  };

  draw();

  screenStream = canvas.captureStream(30);
  return screenStream;
}

/**
 * The real record plus the fakes. Returns the inputs untouched when the query
 * string did not ask for any, so the normal path is genuinely unchanged.
 */
export function withFakeParticipants(
  clients: Record<string, Client>,
  videoStreams: Record<string, MediaStream> | undefined,
  channelId: string | undefined,
  options: FakeParticipantOptions | null,
): {
  clients: Record<string, Client>;
  videoStreams: Record<string, MediaStream> | undefined;
} {
  if (!import.meta.env.DEV || !options) return { clients, videoStreams };

  const withFakes: Record<string, Client> = { ...clients };
  let streams = videoStreams;

  for (let i = 0; i < options.count; i++) {
    const id = `${FAKE_PREFIX}${i}`;
    const sharing = options.share && i === 0;

    withFakes[id] = {
      serverUserId: id,
      nickname: NAMES[i],
      isMuted: i < options.muted,
      isDeafened: false,
      color: "var(--gray-6)",
      streamID: `${id}-audio`,
      hasJoinedChannel: true,
      voiceChannelId: channelId,
      isConnectedToVoice: true,
      isAFK: false,
      screenShareEnabled: sharing,
      screenShareVideoStreamID: sharing ? `${id}-screen` : undefined,
    };

    if (sharing) {
      streams = { ...streams, [`${id}-screen`]: fakeScreenStream() };
    }
  }

  return { clients: withFakes, videoStreams: streams };
}
