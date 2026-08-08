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
 * Dev only. Normally driven from Settings → Developer, which is where it is
 * reachable in the desktop app. The query string still works and overrides the
 * settings while it is present, which is handy in a browser:
 *
 *   ?fake=7              seven fake participants alongside you
 *   ?fake=4&fakeshare=1  ...one of whom is sharing a screen
 *   ?fake=4&fakemuted=2  ...of whom the first two are muted
 *   ?fake=4&fakedeaf=1   ...and the last is deafened
 *   ?fake=4&fakespeak=0  ...none of whom talk
 *
 * The screen share is a real MediaStream off a canvas, not a placeholder, so
 * the tile takes the same code path a real share does — <video> element,
 * object-fit contain, the lot. Speech is the same idea and lives in
 * fakeSpeech.ts: a real audio track per participant, ramped like someone
 * talking, read by the analyser the halo and the ring already use.
 */
import type { MemberInfo } from "../components/MemberSidebar";
import type { Client, UserStatus } from "../types/clients";

const FAKE_PREFIX = "fake-";

/**
 * Enough names for a call and a member list without either borrowing from the
 * other. The people in voice take the front of this list and the rest of the
 * server takes the back, so a name never appears twice on screen.
 */
const NAMES = [
  "Astrid",
  "Bjørn",
  "Dagny",
  "Eirik",
  "Frøya",
  "Guro",
  "Håkon",
  "Ingrid",
  "Jostein",
  "Kari",
  "Liv",
  "Magnus",
  "Nils",
  "Odd",
  "Ragnhild",
  "Sigrid",
  "Torbjørn",
  "Solveig",
  "Vidar",
  "Øystein",
  "Marit",
  "Sindre",
  "Tuva",
  "Leif",
];

export interface FakeParticipantOptions {
  /** People in the voice channel with you. */
  count: number;
  /**
   * People in the server who are not in voice — the rest of the member list.
   * A real server is mostly this: a handful in a call and everyone else
   * around, in various states of not being at their desk.
   */
  members: number;
  muted: number;
  share: boolean;
  /** The last participant is deafened, which also mutes them. */
  deafened: boolean;
  /** Everyone who is not muted or deafened talks on and off. See fakeSpeech.ts. */
  speak: boolean;
}

/**
 * The most of each the name list can cover, given they do not share names.
 * The split is deliberate rather than even: a call is small, a member list is
 * not.
 */
export const MAX_FAKE_PARTICIPANTS = 12;
export const MAX_FAKE_MEMBERS = NAMES.length - MAX_FAKE_PARTICIPANTS;

/** The id a fake participant is known by, everywhere. */
export function fakeParticipantId(index: number): string {
  return `${FAKE_PREFIX}${index}`;
}

/** Their audio stream, which is what a stream source is keyed by. */
export function fakeAudioStreamId(id: string): string {
  return `${id}-audio`;
}

/**
 * A member who is in the server but not in the call, by index.
 *
 * Named from the back of the list so they never collide with the people in
 * voice, and given ids in their own range so nothing can confuse the two.
 */
function fakeMemberId(index: number): string {
  return `${FAKE_PREFIX}member-${index}`;
}

function fakeMemberName(index: number): string {
  return NAMES[NAMES.length - 1 - index];
}

/**
 * How a member who is not in voice is doing.
 *
 * Fixed by index rather than random, so the list does not reshuffle on every
 * render — and weighted, because a server where a third of everyone is offline
 * looks like a server, and one where everybody is online looks like a fixture.
 */
function fakeMemberStatus(index: number): UserStatus {
  const slot = index % 5;
  if (slot === 3) return "afk";
  if (slot === 4 || slot === 1) return "offline";
  return "online";
}

/** Parsed once — the query string cannot change under us. */
export function readFakeParticipantOptions(
  search: string,
): FakeParticipantOptions | null {
  if (!import.meta.env.DEV) return null;

  const params = new URLSearchParams(search);
  const count = Number(params.get("fake")) || 0;
  const members = Number(params.get("fakemembers")) || 0;

  // Either alone is a reasonable thing to ask for: a call with nobody else in
  // the server, or a full server with an empty call.
  if (!Number.isInteger(count) || count < 0 || count > MAX_FAKE_PARTICIPANTS) return null;
  if (count < 1 && members < 1) return null;

  return {
    count,
    members: Math.max(0, Math.min(members, MAX_FAKE_MEMBERS)),
    muted: Math.min(Number(params.get("fakemuted")) || 0, count),
    share: params.get("fakeshare") === "1",
    deafened: params.get("fakedeaf") === "1",
    // On unless asked otherwise. A grid where nobody talks is the state the
    // query string was already able to produce.
    speak: params.get("fakespeak") !== "0",
  };
}

/** The same options built from the Developer settings panel. */
export function fakeParticipantOptionsFromSettings(
  count: number,
  members: number,
  muted: number,
  share: boolean,
  deafened: boolean,
  speak: boolean,
): FakeParticipantOptions | null {
  if (!import.meta.env.DEV) return null;
  // Members alone are worth having: a full server with an empty call is a
  // normal thing to want to look at.
  if (!Number.isInteger(count) || count < 0) return null;
  if (count < 1 && members < 1) return null;

  const capped = Math.min(count, MAX_FAKE_PARTICIPANTS);

  return {
    count: capped,
    members: Math.max(0, Math.min(members, MAX_FAKE_MEMBERS)),
    muted: Math.min(muted, capped),
    share,
    deafened,
    speak,
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
    const id = fakeParticipantId(i);
    const sharing = options.share && i === 0;
    // Deafened people are muted too — the client mutes when you deafen — so the
    // tile should carry both, and the badge shows the deafened one.
    const isDeafened = options.deafened && i === options.count - 1;

    withFakes[id] = {
      serverUserId: id,
      nickname: NAMES[i],
      isMuted: i < options.muted || isDeafened,
      isDeafened,
      color: "var(--gray-6)",
      streamID: fakeAudioStreamId(id),
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

/**
 * The member list: the people in the call, plus the rest of the server.
 *
 * The call half was added because a nine-person call sat next to a members
 * panel saying two. The other half is here because that fix produced the
 * opposite lie — a server where every single member happened to be in voice,
 * which is not what a server looks like either.
 *
 * People in voice are marked in_voice, because they are; the rest are spread
 * across online, AFK and offline by index. The panel groups by status, so
 * getting this wrong puts people under the wrong heading.
 */
export function withFakeMembers(
  members: MemberInfo[],
  channelId: string | undefined,
  options: FakeParticipantOptions | null,
): MemberInfo[] {
  if (!import.meta.env.DEV || !options) return members;

  const fakes: MemberInfo[] = [];

  for (let i = 0; i < options.count; i++) {
    const id = fakeParticipantId(i);
    const isDeafened = options.deafened && i === options.count - 1;

    fakes.push({
      serverUserId: id,
      nickname: NAMES[i],
      avatarFileId: null,
      // Nothing has computed a colour for these, which is exactly the case a
      // real member without an uploaded avatar is in — the tint comes from the
      // generated avatar instead. See tileHue.
      avatarColor: null,
      role: "member",
      status: "in_voice",
      isMuted: i < options.muted || isDeafened,
      isDeafened,
      color: "var(--gray-6)",
      isConnectedToVoice: true,
      hasJoinedChannel: true,
      voiceChannelId: channelId,
      streamID: fakeAudioStreamId(id),
    });
  }

  for (let i = 0; i < options.members; i++) {
    const id = fakeMemberId(i);

    fakes.push({
      serverUserId: id,
      nickname: fakeMemberName(i),
      avatarFileId: null,
      avatarColor: null,
      role: "member",
      status: fakeMemberStatus(i),
      // Mute state is a voice thing. Someone who is not in the call is neither,
      // and showing them as muted in the member list would be inventing a state
      // the real client never produces.
      isMuted: false,
      isDeafened: false,
      color: "var(--gray-6)",
      isConnectedToVoice: false,
      hasJoinedChannel: false,
      voiceChannelId: undefined,
      streamID: fakeAudioStreamId(id),
    });
  }

  return [...members, ...fakes];
}

/**
 * The invented people, as chat senders.
 *
 * Everyone the fixture made up, in voice or not — a server where only the
 * people currently in a call ever say anything is not a server. The ids match
 * the member list exactly, so a message resolves to a real member and gets
 * that member's avatar and name rather than falling back to "Unknown".
 */
export function fakeChatSendersFrom(
  options: FakeParticipantOptions | null,
): Array<{ serverUserId: string; nickname: string }> {
  if (!import.meta.env.DEV || !options) return [];

  const senders: Array<{ serverUserId: string; nickname: string }> = [];
  for (let i = 0; i < options.count; i++) {
    senders.push({ serverUserId: fakeParticipantId(i), nickname: NAMES[i] });
  }
  for (let i = 0; i < options.members; i++) {
    senders.push({ serverUserId: fakeMemberId(i), nickname: fakeMemberName(i) });
  }
  return senders;
}
