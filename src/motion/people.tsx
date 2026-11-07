import carloOwl from "./carlo-owl.svg?raw";
import type { TypingUser } from "../packages/socket/src/hooks/useTypingIndicator";
import { MemberIdentityCard } from "../packages/socket/src/components/MemberIdentityCard";
import { type MemberInfo, MemberSidebar } from "../packages/socket/src/components/MemberSidebar";
import { TypingIndicator } from "../packages/socket/src/components/TypingIndicator";

const person = (id: string, nickname: string, extra: Partial<MemberInfo> = {}): MemberInfo => ({
  serverUserId: `u-${id}`, nickname, status: "online", isMuted: false, isDeafened: false, color: "#968ff8",
  isConnectedToVoice: false, hasJoinedChannel: false, streamID: "", role: "member", ...extra,
});

export const ME = person("me", "Gryt", { role: "owner", statusLine: "Building Owl City" });
// The community server's regulars as of 2026-11-06, with the owls they wear there.
export const FRIENDS: MemberInfo[] = [
  person("carlo", "Carlo", { role: "crew" }),
  person("sivert", "Sivert", {
    role: "crew", avatarFileId: "sivert-avatar.avif", bannerFileId: "sivert-banner.mp4", bannerVideo: true, pronouns: "Giga/Chad", bio: "Creator of Gryt Chat",
    cardStyle: { fill: "solid", c1: "#000000", pattern: "plaid-pattern-1", cover: "card", fade: "none", pScale: 185, pOpacity: 10, pSeed: 32645, pEmoji: "unicode:😈", pStroke: 40, edge: 2 },
  }),
  person("justin", "Justin"),
  person("pingy", "Pingy", {
    avatarFileId: "pingy-avatar.webp", activity: "Deep Rock Galactic", richActivity: { type: "playing", name: "Deep Rock Galactic", startedAt: Date.now() - 52 * 60_000 },
    cardStyle: { fill: "solid", c1: "#fee2cd", pattern: "emoji", cover: "card", pScale: 123, pRotate: 7, pOpacity: 40, pSeed: 29621, pEmoji: "server:Peace", pLayer: "front", edge: 3 },
  }),
  person("al", "Al-JackEson"),
  person("technic", "TechnicSolution"),
  person("leo", "Leo"),
  person("leon", "Leon", { avatarWorn: "adbzbwbg--agaaaa------------------" }),
  person("anise", "Anise"),
  person("sable", "Sable"),
  person("weaver", "Weaver"),
  person("jukebox", "Jukebox", { isBot: true, identityTier: "bot", statusLine: "Now playing: Fireflies, Owl City" }),
];

export function Members({ members }: { members: MemberInfo[] }) {
  return <MemberSidebar members={members} currentServerConnected={null} serverHost={location.host} currentServerUserId="u-me" width={260} />;
}

export function Card({ member }: { member: MemberInfo }) {
  return <MemberIdentityCard member={member} serverHost={location.host} inline />;
}

export function Typing({ who }: { who: MemberInfo[] }) {
  const users: TypingUser[] = who.map((m) => ({ serverUserId: m.serverUserId, nickname: m.nickname, avatarFileId: null }));
  return (
    <div ref={(el) => { const img = el?.querySelector("img"); const url = who[0] && customOwlUrl(who[0].nickname); if (img && url && img.src !== url) img.src = url; }}>
      <TypingIndicator typingUsers={users} serverHost={location.host} />
    </div>
  );
}

/** Owls a member designed themselves, as the SVG their client draws. */
export const CUSTOM_OWLS: Record<string, string> = { Carlo: carloOwl };
export const customOwlUrl = (name: string) => (CUSTOM_OWLS[name] ? `data:image/svg+xml;utf8,${encodeURIComponent(CUSTOM_OWLS[name])}` : undefined);

/** Members with their own uploaded picture keep it; everyone else gets a live owl. */
export const hasPicture = (name: string) => !!FRIENDS.find((f) => f.nickname === name)?.avatarFileId;
