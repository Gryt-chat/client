import type { DmSealingMode, MlsDmContent } from "@gryt/core";
import { reencryptedId } from "@gryt/core";
import type { SealedAttachmentKey } from "@gryt/crypto";

import type { ArchivedMessage } from "@/common";

import type { AttachmentMeta, ChatMessage } from "../components/chatUtils";
import { removedHereLine } from "./ownDevices.ts";
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
    reactions: m.reactions?.length ? m.reactions : null,
    mls: true,
    ...(m.sharedBy && m.sharedBy !== m.senderId ? { shared_by: nameFor(m.sharedBy) ?? "them" } : {}),
    ...(m.receivedAt ? { received_at: new Date(m.receivedAt).toISOString() } : {}),
    ...(m.importedFrom ? { imported_from: m.importedFrom } : {}),
    ...(m.outbox ? { nonce: m.messageId, pending: true, waiting: true, waitingNote: WAITING_NOTE } : {}),
  };
}

export const WAITING_NOTE = "Sends by itself once this device is added to the chat";

/** What goes with a report of an MLS message: this device's copy, which the server can't check (GRYT-1557). */
export function mlsReportCopy(message: Pick<ChatMessage, "sender_server_id" | "text">): { senderServerUserId: string; text: string } {
  return { senderServerUserId: message.sender_server_id, text: message.text ?? "" };
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
  const kept = [...shown, ...archived].filter((m) => {
    if (ids.has(m.message_id)) return false;
    ids.add(m.message_id);
    return m.pending || m.failed || at(m) >= floor;
  });
  // A reply can name a message that has since moved onto MLS under a new id.
  return kept
    .map((m) => {
      const reply = m.reply_to_message_id;
      return reply && !ids.has(reply) && ids.has(reencryptedId(reply)) ? { ...m, reply_to_message_id: reencryptedId(reply) } : m;
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
  peerKeyChanged = false,
}: {
  dmPeer: string | null;
  mode: DmSealingMode | null;
  waiting: boolean;
  archiveFailed: boolean;
  /** Their key changed and nobody has checked it: none of their devices can be added. */
  peerKeyChanged?: boolean;
}): { path: "server" | "mls" | "none"; held: boolean; archiveProblem: boolean } {
  if (!dmPeer) return { path: "server", held: false, archiveProblem: false };
  const disputed = peerKeyChanged && mode?.kind === "mls";
  const held = waiting || mode?.kind === "refused" || disputed;
  const mlsPath = mode?.kind === "mls" && !disputed ? "mls" : "none";
  const path = mode?.kind === "sealed-v1" ? "server" : mlsPath;
  return { path, held, archiveProblem: archiveFailed && held };
}

/** The line above the composer for a DM on, or held off, MLS. Null says nothing. */
export function mlsNotice(
  mode: DmSealingMode | null,
  problems: ConversationProblems,
  {
    lostHistory,
    home,
    peerName,
    signedIn = false,
    peerKeyChanged = false,
  }: { lostHistory: boolean; home: "browser" | "app"; peerName: string; signedIn?: boolean; peerKeyChanged?: boolean },
): string | null {
  const here = home === "browser" ? "this browser" : "this device";
  const Here = home === "browser" ? "This browser" : "This device";
  if (problems.lost === "device_removed") {
    // Version 1 to a peer without MLS still works from here, and needs no warning.
    return mode?.kind === "sealed-v1" ? null : removedHereLine(home, signedIn ? "sign_in" : "recovery_key");
  }
  if (mode?.kind === "refused") {
    if (mode.reason === "peer_left_mls") return `Can't send. ${peerName}'s app stopped using end-to-end encryption here.`;
    if (mode.reason === "server_dropped_mls") return "Can't send. This server stopped supporting end-to-end encryption.";
  }
  if (mode?.kind === "mls" && peerKeyChanged) {
    return `${peerName} has a new key, usually from a new phone or computer. Before you reply, compare codes with them on a call or in person.`;
  }
  if (problems.lost === "too_many_devices") {
    return `${Here} can't use encrypted DMs here because your account has the most devices allowed. Remove the ones you no longer use.`;
  }
  if (problems.lost === "other_identity") {
    return `${Here} has a different key on this server than your account. Use your account's key here and approve it on one of your other devices, or link this device from one of them.`;
  }
  if (problems.lost === "not_added") {
    return `${Here} is new to your chat with ${peerName}. ${peerName}'s app or another of your devices adds it by itself the next time one of them is open. Until then, what you write here waits and goes out on its own.`;
  }
  if (problems.lost === "removed") return `${Here} was taken out of your chat with ${peerName}. Ask to be added again, and ${peerName}'s app or another of your devices adds it back.`;
  if (problems.lost) return `${Here} lost track of this conversation's encryption, so new messages won't show here until it rejoins.`;
  // After the reasons above: each of those says what to do, and this line doesn't.
  if (mode?.kind === "refused") return `Can't send yet. ${Here} isn't set up for end-to-end encryption here.`;
  if (problems.undecryptable > 0) {
    const n = problems.undecryptable;
    return `${n} ${n === 1 ? "message" : "messages"} couldn't be opened on ${here}. ${peerName} has ${n === 1 ? "it" : "them"} and can send you a copy.`;
  }
  if (lostHistory) return `Older messages were cleared from ${here}. ${peerName} can send you a copy.`;
  if (mode?.kind === "mls" && home === "browser") return "Messages here are only kept in this browser. Clearing its site data deletes them.";
  return null;
}

const TRY_AGAIN = "It's back in the message box. Press Send to try again.";
const FAILURE_REASONS: Record<string, string> = {
  offline: "The server didn't answer in time.",
  stopped: "The connection to the server closed.",
  refused: "The server turned it down.",
  commit_retries: "Other devices kept changing this chat at the same time.",
  not_in_group: "This device hasn't been added to this chat yet.",
  no_device: "Encrypted messages haven't started on this device yet.",
  too_many_attachments: "That's more files than one message can carry.",
};

/** What a failed MLS send says on its row. */
export function sendFailure(e: unknown, home: "browser" | "app"): string {
  const code = (e as { code?: string })?.code;
  if (code === "unexpected_member") {
    const here = home === "browser" ? "this browser" : "this device";
    const restart = home === "browser" ? "reload the page" : "restart Gryt";
    return `Not sent. Someone in this chat has a key ${here} doesn't know, so Gryt won't send it to them. If you just linked ${here}, ${restart}. ${TRY_AGAIN}`;
  }
  if (code === "device_removed") return "Not sent. This device was removed from encrypted messages on this server.";
  if (code === "peer_unverified") return "Not sent. Their key isn't trusted on this device yet. Compare codes with them, then send it again.";
  if (code === "other_identity") return `Not sent. ${home === "browser" ? "This browser" : "This device"} needs to be linked to your account's key first.`;
  if (code === "waiting_for_welcome") {
    return `Not sent. ${home === "browser" ? "This browser" : "This device"} still isn't in this chat after half an hour. It's back in the message box to send once the other person or another of your devices has been online.`;
  }
  return `Not sent. ${(code && FAILURE_REASONS[code]) ?? "Something went wrong while encrypting it."} ${TRY_AGAIN}`;
}
