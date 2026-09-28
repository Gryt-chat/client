import type { DmSealingMode, MlsDmContent } from "@gryt/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";

import {
  getUploadsFileUrl,
  openAttachment,
  openLocalArchive,
  sealAttachment,
  type SealedAttachmentKey,
  useLocalArchive,
} from "@/common";

import type { AttachmentMeta, ChatMessage } from "../components/chatUtils";
import { draftKey, returnDraft } from "../hooks/returnedDrafts";
import { uploadChatFile } from "../hooks/uploadChatFile";
import { getMediaDimensions } from "../utils/imageUtils";
import { openSealedAttachment } from "../utils/sealedAttachments";
import { useMlsSource } from "./serverMls";
import type { ConversationProblems } from "./session";
import { archivedRow, newMessage, sendFailure, withOpenedFiles } from "./timeline";

const PAGE = 50;
/** Coalesces a catch-up's hundreds of archive writes into a few redraws. */
const RELOAD_DEBOUNCE_MS = 150;
const MODE_RETRY_MS = 5000;
const NO_PROBLEMS: ConversationProblems = { undecryptable: 0, lost: null };

export interface MlsConversation {
  /** Null while it's being worked out, and for anything that isn't a one-to-one DM. */
  mode: DmSealingMode | null;
  /** A DM whose mode isn't known yet. Sending now could seal to somebody already on MLS. */
  waiting: boolean;
  /** MLS messages from the archive, and sends not yet through. */
  rows: ChatMessage[];
  hasMore: boolean;
  loadOlder: () => void;
  problems: ConversationProblems;
  lostHistory: boolean;
  home: "browser" | "app";
  /** This device's history won't open, so a DM can't be read or sent to until it does or is cleared. */
  archiveFailed: boolean;
  send: (text: string, files: File[], replyTo?: string) => void;
  edit: (messageId: string, text: string) => void;
  remove: (messageId: string) => void;
}

/** One DM on MLS: its mode, its archived messages and its sends (design, sections 5 and 6). */
export function useMlsConversation({
  host,
  conversationId,
  peer,
  me,
  nameFor,
}: {
  host: string;
  conversationId: string;
  /** The other person, only for a one-to-one DM. Groups are stage 2. */
  peer: string | null;
  me: { serverUserId?: string; nickname: string };
  nameFor: (id: string) => string | undefined;
}): MlsConversation {
  const source = useMlsSource(host);
  const archiveNow = useLocalArchive();
  const archiveOpen = archiveNow.status.kind === "open";
  const archiveEpoch = archiveNow.epoch;
  const [mode, setMode] = useState<DmSealingMode | null>(null);
  const [archived, setArchived] = useState<ChatMessage[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [hasMore, setHasMore] = useState(false);
  const [drafts, setDrafts] = useState<ChatMessage[]>([]);
  const [problems, setProblems] = useState<ConversationProblems>(NO_PROBLEMS);
  const [archiveFacts, setArchiveFacts] = useState({ lostHistory: false, home: "app" as "browser" | "app" });
  const [opened, setOpened] = useState<ReadonlyMap<string, AttachmentMeta | "failed">>(new Map());
  /** Each file's key, from the archive, and the ones already being fetched. */
  const fileKeys = useRef(new Map<string, SealedAttachmentKey>());
  const opening = useRef(new Set<string>());
  const objectUrls = useRef(new Set<string>());
  const nameRef = useRef(nameFor);
  nameRef.current = nameFor;
  const meRef = useRef(me);
  meRef.current = me;

  const active = !!(source && conversationId && peer);

  useEffect(() => {
    setMode(null);
    setArchived([]);
    setDrafts([]);
    setLimit(PAGE);
    setOpened(new Map());
    opening.current.clear();
    fileKeys.current.clear();
  }, [host, conversationId]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // The mode, again whenever the driver says something moved.
  useEffect(() => {
    if (!source || !conversationId || !peer) return;
    let live = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (retry) clearTimeout(retry);
      source
        .modeFor(conversationId, peer)
        .then((next) => {
          if (!live) return;
          setMode(next);
          setProblems(source.problems(conversationId));
        })
        .catch((e: unknown) => {
          // Waiting on the archive isn't worth a warning every few seconds.
          if ((e as { code?: string })?.code !== "archive_closed") console.warn("[MLS] Couldn't tell how to send here:", e);
          if (live) retry = setTimeout(refresh, MODE_RETRY_MS);
        });
      setProblems(source.problems(conversationId));
    };
    refresh();
    const off = source.onChange((id) => {
      if (id === null || id === conversationId) refresh();
    });
    return () => {
      live = false;
      if (retry) clearTimeout(retry);
      off();
    };
  }, [source, conversationId, peer]);

  // This device's copy, reloaded a little after each change so a catch-up draws in batches.
  useEffect(() => {
    if (!source || !conversationId || !peer) return;
    const scope = source.storeScope;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let off = () => {};
    void openLocalArchive()
      .then((archive) => {
        if (!live) return;
        setArchiveFacts({ lostHistory: archive.lostHistory, home: archive.home });
        const load = async () => {
          const page = await archive.messages.page(scope, conversationId, { limit });
          const onPage = new Set(page.map((m) => m.messageId));
          const quoted = new Map<string, ChatMessage>();
          for (const m of page) {
            if (!m.replyTo || onPage.has(m.replyTo) || quoted.has(m.replyTo)) continue;
            const original = await archive.messages.get(scope, conversationId, m.replyTo);
            if (original) quoted.set(m.replyTo, archivedRow(original, (id) => nameRef.current(id)));
          }
          if (!live) return;
          for (const m of page) for (const [fileId, key] of Object.entries(m.attachments)) fileKeys.current.set(fileId, key);
          setArchived(
            page.map((m) => {
              const row = archivedRow(m, (id) => nameRef.current(id));
              const original = m.replyTo ? quoted.get(m.replyTo) : undefined;
              return original ? { ...row, reply_original: original } : row;
            }),
          );
          setHasMore(page.length === limit);
        };
        void load();
        off = archive.messages.onChange((change) => {
          if (change.scope !== scope || change.conversationId !== conversationId) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void load(), RELOAD_DEBOUNCE_MS);
        });
      })
      .catch((e: unknown) => console.warn("[MLS] The archive didn't open:", e));
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      off();
    };
  }, [source, conversationId, peer, limit, archiveOpen, archiveEpoch]);

  // Files are fetched and decrypted once each, the way a sealed DM's are.
  useEffect(() => {
    if (!conversationId) return;
    for (const row of archived) {
      for (const fileId of row.attachments ?? []) {
        const key = fileKeys.current.get(fileId);
        if (!key || opened.has(fileId) || opening.current.has(fileId)) continue;
        opening.current.add(fileId);
        openSealedAttachment({
          fileId,
          key,
          fileUrl: () => getUploadsFileUrl(host, fileId),
          openFile: (ciphertext, meta) => openAttachment({ ciphertext, conversationId, meta }),
          keepUrl: (url) => objectUrls.current.add(url),
        })
          .then(
            (meta): AttachmentMeta | "failed" => meta,
            (e: unknown): "failed" => {
              console.warn("[MLS] A file didn't open:", fileId, e);
              return "failed";
            },
          )
          .then((result: AttachmentMeta | "failed") => {
            // Dropped if the view moved to another conversation meanwhile.
            if (!opening.current.delete(fileId)) return;
            setOpened((current) => new Map(current).set(fileId, result));
          });
      }
    }
  }, [host, conversationId, archived, opened]);

  const fail = useCallback((nonce: string, failure: string) => {
    setDrafts((current) => current.map((m) => (m.nonce === nonce ? { ...m, pending: false, failed: true, failure } : m)));
  }, []);

  const send = useCallback<MlsConversation["send"]>(
    (raw, files, replyTo) => {
      const text = raw.trim();
      if ((!text && files.length === 0) || !source || !conversationId || !peer) return;
      const nonce = uuidv4();
      const local = files.map((f) => ({
        file_id: `local-${uuidv4()}`,
        mime: f.type || null,
        size: f.size,
        original_name: f.name,
        width: null,
        height: null,
        has_thumbnail: false,
        local_url: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
      }));
      for (const f of local) if (f.local_url) objectUrls.current.add(f.local_url);
      setDrafts((current) => [
        ...current,
        {
          conversation_id: conversationId,
          // Pending until the archive's copy, under the nonce, replaces it.
          message_id: `pending-${nonce}`,
          nonce,
          sender_server_id: meRef.current.serverUserId || "temp",
          sender_nickname: meRef.current.nickname || undefined,
          text: text || null,
          attachments: local.length ? local.map((f) => f.file_id) : null,
          enriched_attachments: local.length ? local : null,
          created_at: new Date(),
          reactions: null,
          reply_to_message_id: replyTo ?? null,
          pending: true,
          mls: true,
        },
      ]);

      void (async () => {
        // Sealed the way a sealed DM's files are; the keys ride inside the message (GRYT-1523).
        const uploaded = await Promise.all(
          files.map(async (f) =>
            uploadChatFile(f, host, await getMediaDimensions(f), (bytes, about) =>
              sealAttachment({ bytes, conversationId, ...about }),
            ),
          ),
        );
        const content = newMessage(nonce, text, replyTo, {
          ids: uploaded.map((u) => u.fileId),
          keys: Object.fromEntries(uploaded.flatMap((u) => (u.meta ? [[u.fileId, u.meta]] : []))),
        });
        if (!content) throw Object.assign(new Error("A file wasn't encrypted."), { code: "file_not_sealed" });
        await source.send(conversationId, peer, content);
      })().catch((e: unknown) => {
        console.warn("[MLS] Send failed:", e);
        const code = (e as { code?: string })?.code;
        fail(nonce, code === "file_not_sealed" ? "Not sent. A file wasn't encrypted." : sendFailure(e, archiveFacts.home));
        returnDraft(draftKey(host, conversationId), { text, files });
      });
    },
    [source, host, conversationId, peer, fail, archiveFacts.home],
  );

  const change = useCallback(
    (content: MlsDmContent, failure: string) => {
      if (!source || !conversationId || !peer) return;
      source.send(conversationId, peer, content).catch((e: unknown) => {
        console.warn(`[MLS] The ${content.type} didn't go:`, e);
        toast.error(failure);
      });
    },
    [source, conversationId, peer],
  );

  // A sent draft goes once its archived copy, under its nonce, is on screen.
  const rows = useMemo(() => {
    if (!active) return [];
    const archivedIds = new Set(archived.map((m) => m.message_id));
    return [...archived.map((m) => withOpenedFiles(m, opened)), ...drafts.filter((d) => !archivedIds.has(d.nonce ?? ""))];
  }, [active, archived, drafts, opened]);

  useEffect(() => {
    const archivedIds = new Set(archived.map((m) => m.message_id));
    setDrafts((current) =>
      current.some((d) => archivedIds.has(d.nonce ?? "")) ? current.filter((d) => !archivedIds.has(d.nonce ?? "")) : current,
    );
  }, [archived]);

  return {
    mode: active ? mode : null,
    // Held with nothing to ask yet too: version 1 to somebody seen on MLS is what decision 4 forbids.
    waiting: !!conversationId && !!peer && (!source || mode === null),
    rows,
    hasMore: active && hasMore,
    loadOlder: useCallback(() => {
      if (hasMore) setLimit((n) => n + PAGE);
    }, [hasMore]),
    problems: active ? problems : NO_PROBLEMS,
    lostHistory: active && archiveFacts.lostHistory,
    home: archiveFacts.home,
    archiveFailed: !!conversationId && !!peer && archiveNow.status.kind === "failed",
    send,
    edit: useCallback(
      (id: string, text: string) => {
        const body = text.trim();
        if (body) change({ type: "edit", id, text: body }, "Couldn't edit that message.");
      },
      [change],
    ),
    remove: useCallback((id: string) => change({ type: "delete", id }, "Couldn't delete that message."), [change]),
  };
}
