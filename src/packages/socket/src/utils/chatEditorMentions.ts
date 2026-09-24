/** The pills an editing message's mentions parse back into (GRYT-1461), kept
    DOM-free so a test can reserialize `pill.dataset` and prove a round trip. */
import {
  channelHref,
  findMentionLinks,
  type MentionTarget,
  PRIVATE_CHANNEL,
} from "../../../lib/mentionTokens.ts";

/** A channel's name when the editor's viewer can see it, else null. Only
    called for this server's own channels; a host-qualified one is private. */
export type EditorChannelName = (id: string, host: string | null) => string | null;

export interface EditorPill {
  dataset: Record<string, string>;
  text: string;
}

export type EditorSegment = { text: string } | { pill: EditorPill };

function pillFor(target: MentionTarget, label: string, channelName: EditorChannelName): EditorPill {
  if (target.kind === "channel") {
    const dataset: Record<string, string> = { channelId: target.id };
    if (target.host) dataset.channelHost = target.host;
    const name = target.host ? null : channelName(target.id, target.host);
    return { dataset, text: name ? `#${name}` : PRIVATE_CHANNEL };
  }
  if (target.kind === "role") {
    return { dataset: { roleId: target.id, mentionName: label }, text: label };
  }
  // user, everyone, here: the same pill shape, keyed by the id the link already carries.
  const id = target.kind === "user" ? target.id : target.kind;
  return { dataset: { mentionId: id, mentionName: label }, text: label };
}

/** The stored text, split into plain runs and the mentions within it.
    `channelName` only picks a display name; the pill keeps the real link. */
export function parseEditSegments(text: string, channelName: EditorChannelName): EditorSegment[] {
  const segments: EditorSegment[] = [];
  let cursor = 0;
  for (const match of findMentionLinks(text)) {
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index) });
    segments.push({ pill: pillFor(match.target, match.label, channelName) });
    cursor = match.index + match.length;
  }
  if (cursor < text.length || segments.length === 0) segments.push({ text: text.slice(cursor) });
  return segments;
}

/** Mirrors ChatEditor's `serializeContentEditable`, so a round trip can be
    checked against `parseEditSegments`' output with no real DOM. */
export function reserializeEditSegments(segments: EditorSegment[]): string {
  let result = "";
  for (const segment of segments) {
    if ("text" in segment) {
      result += segment.text;
      continue;
    }
    const { dataset, text } = segment.pill;
    if (dataset.roleId) {
      result += `[${dataset.mentionName || text}](role:${dataset.roleId})`;
    } else if (dataset.channelId) {
      result += `[#channel](${channelHref(dataset.channelId, dataset.channelHost || null)})`;
    } else if (dataset.mentionId) {
      result += `[${dataset.mentionName || text}](mention:${dataset.mentionId})`;
    }
  }
  return result;
}
