import type { DmSealingMode, MlsDmContent } from "@gryt/core";
import type { SealedAttachmentKey } from "@gryt/crypto";

import type { ArchivedMessage } from "@/common";

import type { AttachmentMeta, ChatMessage } from "../components/chatUtils";
import type { ConversationProblems } from "./session";

/* A DM on MLS reads from two places: the server's history for old messages, and this
   device's archive for MLS ones. Pure, so the merge has tests. Mirrors the phone's. */

/** The server's stand-in for an MLS message, for apps that can't read it (GRYT-1517). */
export function isMlsPlaceholder(message: ChatMessage): boolean {
  return !!message.mls_placeholder;
}

export function archivedRow(m: ArchivedMessage, nameFor: (id: string) => string | undefined): ChatMessage {
  const files = Object.keys(m.attachments);
  return {
    conversation_id: m.conversationId,
    message_id: m.messageId,
    sender_server_id: m.senderId,
    sender_nickname: nameFor(m.senderId),
    text: m.text || null,
    attachments: files.length ? files : null,
    created_at: new Date(m.sentAt).toISOString(),
    edited_at: m.editedAt === undefined ? null : new Date(m.editedAt).toISOString(),
    reply_to_message_id: m.replyTo ?? null,
    reactions: null,
    mls: true,
  };
}

/** The row with its files as far as they've opened. One that won't open shows as its id. */
export function withOpenedFiles(row: ChatMessage, opened: ReadonlyMap<string, AttachmentMeta | "failed">): ChatMessage {
  if (!row.attachments?.length || row.pending || row.failed) return row;
  const shown = row.attachments.flatMap((id): AttachmentMeta[] => {
    const o = opened.get(id);
    if (o === undefined) return [];
    if (o !== "failed") return [o];
    return [{ file_id: id, mime: null, size: null, original_name: null, width: null, height: null, has_thumbnail: false }];
  });
  return shown.length ? { ...row, enriched_attachments: shown } : row;
}

/**
 * A new message, or null when a file has no key: sent anyway, it would reach them as
 * something they can't open.
 */
export function newMessage(
  id: string,
  text: string,
  replyTo: string | null | undefined,
  files: { ids: string[]; keys?: Record<string, SealedAttachmentKey> | null } | null | undefined,
): Extract<MlsDmContent, { type: "message" }> | null {
  const content: Extract<MlsDmContent, { type: "message" }> = { type: "message", id, text };
  if (replyTo) content.replyTo = replyTo;
  if (files?.ids.length) {
    const attachments: Record<string, SealedAttachmentKey> = {};
    for (const fileId of files.ids) {
      const key = files.keys?.[fileId];
      if (!key) return null;
      attachments[fileId] = key;
    }
    content.attachments = attachments;
  }
  return content;
}

const at = (m: ChatMessage) => new Date(m.created_at).getTime() || 0;

/**
 * Both lists by time, placeholders dropped. Each side is paged on its own, so nothing older
 * than the newer of the two oldest loaded rows is shown until the other side catches up.
 */
export function mergeTimeline({
  server,
  serverHasMore,
  archived,
  archiveHasMore,
}: {
  server: ChatMessage[];
  serverHasMore: boolean;
  archived: ChatMessage[];
  archiveHasMore: boolean;
}): ChatMessage[] {
  const shown = server.filter((m) => !isMlsPlaceholder(m));
  const settled = (list: ChatMessage[]) => list.filter((m) => !m.pending && !m.failed);
  const floorOf = (list: ChatMessage[], more: boolean) =>
    more && settled(list).length ? Math.min(...settled(list).map(at)) : -Infinity;
  const floor = Math.max(floorOf(shown, serverHasMore), floorOf(archived, archiveHasMore));

  const ids = new Set<string>();
  return [...shown, ...archived]
    .filter((m) => {
      if (ids.has(m.message_id)) return false;
      ids.add(m.message_id);
      return m.pending || m.failed || at(m) >= floor;
    })
    .sort((a, b) => at(a) - at(b));
}

/**
 * Where a send goes: "server" is a channel or version 1, which never needs the archive. Only a
 * DM still waiting on its mode, or refused, holds the composer and shows an archive problem.
 */
export function dmComposer({
  dmPeer,
  mode,
  waiting,
  archiveFailed,
}: {
  dmPeer: string | null;
  mode: DmSealingMode | null;
  waiting: boolean;
  archiveFailed: boolean;
}): { path: "server" | "mls" | "none"; held: boolean; archiveProblem: boolean } {
  if (!dmPeer) return { path: "server", held: false, archiveProblem: false };
  const held = waiting || mode?.kind === "refused";
  const path = mode?.kind === "sealed-v1" ? "server" : mode?.kind === "mls" ? "mls" : "none";
  return { path, held, archiveProblem: archiveFailed && held };
}

/** The line above the composer for a DM on, or held off, MLS. Null says nothing. */
export function mlsNotice(
  mode: DmSealingMode | null,
  problems: ConversationProblems,
  { lostHistory, home, peerName }: { lostHistory: boolean; home: "browser" | "app"; peerName: string },
): string | null {
  const here = home === "browser" ? "this browser" : "this device";
  const Here = home === "browser" ? "This browser" : "This device";
  if (mode?.kind === "refused") {
    if (mode.reason === "peer_left_mls") return `Can't send. ${peerName}'s app stopped using end-to-end encryption here.`;
    if (mode.reason === "server_dropped_mls") return "Can't send. This server stopped supporting end-to-end encryption.";
    return `Can't send yet. ${Here} isn't set up for end-to-end encryption here.`;
  }
  if (problems.lost === "removed") return `${Here} was taken out of this conversation, so new messages won't show here.`;
  if (problems.lost) return `${Here} lost track of this conversation's encryption, so new messages won't show here.`;
  if (problems.undecryptable > 0) {
    const n = problems.undecryptable;
    return `${n} ${n === 1 ? "message" : "messages"} couldn't be decrypted on ${here}.`;
  }
  if (lostHistory) return `Older messages were cleared from ${here}.`;
  if (mode?.kind === "mls" && home === "browser") return "Messages here are only kept in this browser. Clearing its site data deletes them.";
  return null;
}

/** What a failed MLS send says on its row. */
export function sendFailure(e: unknown, home: "browser" | "app"): string {
  const code = (e as { code?: string })?.code;
  if (code === "peer_unverified") return "Not sent. Their keys couldn't be checked.";
  if (code === "waiting_for_welcome") {
    return `Not sent. ${home === "browser" ? "This browser" : "This device"} hasn't been added to the conversation yet.`;
  }
  return "Not sent.";
}
