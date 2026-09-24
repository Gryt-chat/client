/* Byte for byte the same in client (src/packages/lib) and mobile (src/chat), and
   checked in both against mention-vectors.json, which the server shares. */

/** What a `[label](href)` in message text points at, when it is a mention. */
export type MentionTarget =
  | { kind: "user"; id: string }
  | { kind: "everyone" }
  | { kind: "here" }
  | { kind: "role"; id: string }
  | { kind: "channel"; id: string; host: string | null };

const ROLE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const CHANNEL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HOST = /^[A-Za-z0-9.-]+(:[0-9]{1,5})?$/;
const LINK = /\[([^\]\n]*)\]\(([^)\s]*)\)/g;
const LITERAL = /(```|~~~)[\s\S]*?(?:\1|$)|`[^`\n]*`/g;

/** Shown for a channel the reader can't see, so its name never reaches them. */
export const PRIVATE_CHANNEL = "#private-channel";

export function mentionTarget(href: string): MentionTarget | null {
  if (href.startsWith("mention:")) {
    const id = href.slice("mention:".length);
    if (id === "everyone") return { kind: "everyone" };
    if (id === "here") return { kind: "here" };
    return id ? { kind: "user", id } : null;
  }
  if (href.startsWith("role:")) {
    const id = href.slice("role:".length);
    return ROLE_ID.test(id) ? { kind: "role", id } : null;
  }
  if (href.startsWith("channel:")) {
    const ref = href.slice("channel:".length);
    const slash = ref.lastIndexOf("/");
    const host = slash === -1 ? null : ref.slice(0, slash);
    const id = slash === -1 ? ref : ref.slice(slash + 1);
    if (!CHANNEL_ID.test(id)) return null;
    if (host !== null && !HOST.test(host)) return null;
    return { kind: "channel", id, host };
  }
  return null;
}

/** The href a channel mention is written with. No host means this server. */
export function channelHref(id: string, host: string | null = null): string {
  return host ? `channel:${host}/${id}` : `channel:${id}`;
}

export interface MentionViewer {
  roleIds?: readonly string[];
  /** The per-server "Suppress @everyone and @here" setting. */
  suppressEveryone?: boolean;
}

/** Whether @everyone, @here or one of the viewer's roles names them. The server
    writes these links only when they pinged, so the text is the answer. */
export function massMentionHits(text: string, viewer: MentionViewer): boolean {
  const prose = text.replace(LITERAL, " ");
  for (const m of prose.matchAll(LINK)) {
    const target = mentionTarget(m[2]);
    if (!target) continue;
    if ((target.kind === "everyone" || target.kind === "here") && !viewer.suppressEveryone) return true;
    if (target.kind === "role" && viewer.roleIds?.includes(target.id)) return true;
  }
  return false;
}

/** A channel's name when the reader can see it, else null. */
export type ChannelName = (id: string, host: string | null) => string | null;

/** Mass, role and channel links as words. User links are left for the caller. */
export function plainMentionTokens(text: string, channelName: ChannelName): string {
  return text.replace(LINK, (whole: string, label: string, href: string) => {
    const target = mentionTarget(href);
    if (!target || target.kind === "user") return whole;
    if (target.kind === "everyone" || target.kind === "here") return `@${target.kind}`;
    if (target.kind === "role") {
      const name = label.trim().replace(/^@/, "");
      return name ? `@${name}` : "@role";
    }
    const name = channelName(target.id, target.host);
    return name ? `#${name}` : PRIVATE_CHANNEL;
  });
}
