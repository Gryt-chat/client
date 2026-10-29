import type { DirectConversation } from "@gryt/core";
import { Avatar, Button } from "@gryt/ui";
import { type ReactNode, useEffect, useState } from "react";

import { getUploadsFileUrl, identityScopeFor, openAttachment, openLocalArchive, resolveAvatarSrc, type SealedAttachmentKey } from "@/common";

import { PiArchiveFill, PiDoorOpenBold,PiEyeSlashFill, PiFileFill, PiMagnifyingGlassBold, PiPlus } from "../../../../lib/icons";
import type { usePins } from "../hooks/usePins";
import { fetchSealedAttachment } from "../utils/sealedAttachments";
import { EmojiText } from "./EmojiText";
import { GroupFace } from "./GroupFace";
import { MemberIdentityCard } from "./MemberIdentityCard";
import type { MemberInfo } from "./MemberSidebar";
import { statusConfig } from "./memberStatus";
import { PresenceDot } from "./PresenceDot";

export const PANEL_WIDTH = 336;
const THUMBS = 6;

interface SharedFile {
  fileId: string;
  name: string | null;
  /** A blob URL for an image this device opened, or null for anything else. */
  thumb: string | null;
}

/**
 * Files in a conversation, as this device holds them: a count and the newest few.
 * Images are opened here to draw a thumbnail; nothing is asked of the server but the bytes.
 */
function useSharedFiles(host: string, conversationId: string): { count: number; files: SharedFile[] } {
  const [state, setState] = useState<{ count: number; files: SharedFile[] }>({ count: 0, files: [] });

  useEffect(() => {
    let live = true;
    const made: string[] = [];
    void openLocalArchive()
      .then(async (archive) => {
        const scope = identityScopeFor(host);
        const found: { fileId: string; key: SealedAttachmentKey }[] = [];
        let before: { sentAt: number; messageId: string } | undefined;
        for (;;) {
          const page = await archive.messages.page(scope, conversationId, { before, limit: 500 });
          for (const m of [...page].reverse()) {
            for (const [fileId, key] of Object.entries(m.attachments)) found.push({ fileId, key });
          }
          if (page.length < 500) break;
          before = { sentAt: page[0].sentAt, messageId: page[0].messageId };
        }
        if (!live) return;
        const newest = found.slice(0, THUMBS);
        setState({ count: found.length, files: newest.map((f) => ({ fileId: f.fileId, name: f.key.name ?? null, thumb: null })) });
        for (const f of newest) {
          if (!(f.key.mime ?? "").startsWith("image/")) continue;
          const blob = await fetchSealedAttachment({
            url: getUploadsFileUrl(host, f.fileId),
            key: f.key,
            openFile: (ciphertext, meta) => openAttachment({ ciphertext, conversationId, meta }),
          }).catch(() => null);
          if (!blob || !live) continue;
          const url = URL.createObjectURL(blob);
          made.push(url);
          setState((prev) => ({ ...prev, files: prev.files.map((x) => (x.fileId === f.fileId ? { ...x, thumb: url } : x)) }));
        }
      })
      .catch(() => {
        // No archive here: the section reads as no files, which is what this device holds.
      });
    return () => {
      live = false;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [host, conversationId]);

  return state;
}

function Heading({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex items-baseline px-0.5">
      <h3 className="m-0 text-[13px] font-bold text-gryt-neutral-11">{title}</h3>
      {detail && <span className="ml-auto text-xs text-gryt-muted">{detail}</span>}
    </div>
  );
}

function SharedFiles({ host, conversationId }: { host: string; conversationId: string }) {
  const { count, files } = useSharedFiles(host, conversationId);
  return (
    <section className="flex flex-col gap-2">
      <Heading title="Shared files" detail={`${count} on this device`} />
      {files.length === 0 ? (
        <p className="m-0 px-0.5 text-xs text-gryt-muted">Nothing shared that this device has.</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {files.map((f) => (
            <div
              key={f.fileId}
              title={f.name ?? undefined}
              className="flex aspect-square items-center justify-center overflow-hidden rounded-(--gryt-radius-md) bg-gryt-neutral-4"
            >
              {f.thumb ? (
                <img src={f.thumb} alt={f.name ?? ""} className="h-full w-full object-cover" />
              ) : (
                <PiFileFill size={20} style={{ color: "var(--gryt-accent-11)" }} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Pinned({ pins, memberList, onJump }: { pins: ReturnType<typeof usePins>; memberList?: Record<string, MemberInfo>; onJump: (messageId: string) => void }) {
  useEffect(() => {
    pins.fetchList();
    // Once per conversation; the hook keeps the list current after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const list = pins.list ?? [];
  /* Nothing to show, and nothing to promise: a message sent over MLS can't be pinned,
     which since 1.12 is every new one in a DM. Older conversations keep theirs. */
  if (list.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <Heading title="Pinned" detail={String(list.length)} />
      {(
        list.slice(0, 5).map((m) => (
          <button
            key={m.message_id}
            type="button"
            onClick={() => onJump(m.message_id)}
            className="cursor-pointer truncate rounded-(--gryt-radius-md) border-0 bg-gryt-neutral-3 px-2.5 py-2 text-left text-[13px] text-gryt-text hover:bg-gryt-neutral-4"
            title={memberList?.[m.sender_server_id]?.nickname}
          >
            <EmojiText text={m.text ?? "Attachment"} />
          </button>
        ))
      )}
    </section>
  );
}

const footerButton = "mt-auto flex cursor-pointer items-center gap-2 border-0 bg-transparent px-1 py-2 text-left text-sm";

function Option({ icon, label, detail, onClick }: { icon: ReactNode; label: string; detail?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-[38px] w-full cursor-pointer items-center gap-2.5 rounded-(--gryt-radius-full) border-0 bg-transparent px-2.5 text-left text-sm text-gryt-neutral-11 hover:bg-gryt-neutral-3 hover:text-gryt-text">
      <span className="flex text-gryt-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {detail && <span className="text-xs text-gryt-muted">{detail}</span>}
    </button>
  );
}

/** Board D1: their card as one row, then the options laid out bare, then what this conversation holds. */
export function DmPersonPanel({
  host, member, conversation, pins, memberList, onJump, onHide, onSearch, onImport, importSection,
}: {
  host: string;
  member?: MemberInfo;
  conversation: DirectConversation;
  pins: ReturnType<typeof usePins>;
  memberList?: Record<string, MemberInfo>;
  onJump: (messageId: string) => void;
  onHide: () => void;
  onSearch: () => void;
  onImport?: () => void;
  importSection?: ReactNode;
}) {
  // shortcut: D1 is dev-only until the Discord import ships with it (GRYT-1965).
  const redesign = import.meta.env.DEV;
  const [fullCard, setFullCard] = useState(!redesign);
  const name = member?.nickname || conversation.other.nickname;
  const status = member?.status;
  const where = [status && statusConfig[status].label, member?.activity].filter(Boolean).join(" · ");
  return (
    <aside
      aria-label={`About ${conversation.other.nickname}`}
      data-gryt="dm-info"
      className="flex h-full shrink-0 flex-col gap-3 overflow-y-auto p-2"
      style={{ width: PANEL_WIDTH, background: "var(--gryt-neutral-2)", borderRadius: "var(--gryt-radius-lg)" }}
    >
      {fullCard && member ? (
        <MemberIdentityCard member={member} serverHost={host} inline />
      ) : (
        <div
          className="flex items-center gap-3 p-3"
          style={{ borderRadius: 20, background: `linear-gradient(135deg, color-mix(in oklab, ${member?.avatarColor ?? "var(--gryt-accent-9)"} 22%, var(--gryt-neutral-3)), var(--gryt-neutral-3) 70%)` }}
        >
          <span className="relative inline-flex shrink-0">
            <Avatar size="large" fallback={name[0]} src={resolveAvatarSrc(conversation.other.avatar_file_id ? getUploadsFileUrl(host, conversation.other.avatar_file_id, { thumb: true }) : undefined, conversation.other.nickname, conversation.other.avatar_worn)} />
            {status && (
              <span className="absolute rounded-(--gryt-radius-full)" style={{ bottom: -1, right: -1, padding: 2, background: "var(--gryt-neutral-3)" }}>
                <PresenceDot status={status} size={11} />
              </span>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[17px] font-bold"><EmojiText text={name} /></span>
            {where && <span className="truncate text-xs text-gryt-muted">{where}</span>}
          </span>
          {member && redesign && (
            <button type="button" onClick={() => setFullCard(true)} className="gryt-link shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs">
              Full card
            </button>
          )}
        </div>
      )}
      {fullCard && member && redesign && (
        <button type="button" onClick={() => setFullCard(false)} className="gryt-link -mt-1 cursor-pointer self-end border-0 bg-transparent px-2 text-xs">
          Show less
        </button>
      )}
      <div className="flex flex-col gap-4 px-1.5">
        {redesign && <div className="flex flex-col gap-0.5">
          <Option icon={<PiMagnifyingGlassBold size={16} />} label="Search in this chat" onClick={onSearch} />
          {onImport && <Option icon={<PiArchiveFill size={16} />} label="Import from Discord" onClick={onImport} />}
        </div>}
        {importSection}
        <Pinned pins={pins} memberList={memberList} onJump={onJump} />
        <SharedFiles host={host} conversationId={conversation.conversation_id} />
      </div>
      <button type="button" onClick={onHide} className={`${footerButton} mx-2 text-gryt-neutral-11 hover:text-gryt-text`}>
        <PiEyeSlashFill size={16} /> Hide conversation
      </button>
    </aside>
  );
}

/** Board 3: the group's face and name, who's in it, and what it holds. */
export function DmGroupPanel({
  host, conversation, self, memberList, onEdit, onAdd, onLeave,
}: {
  host: string;
  conversation: DirectConversation;
  self?: DirectConversation["other"];
  memberList?: Record<string, MemberInfo>;
  onEdit: () => void;
  onAdd: () => void;
  onLeave: () => void;
}) {
  return (
    <aside
      aria-label="Group"
      data-gryt="dm-info"
      className="flex h-full shrink-0 flex-col gap-5 overflow-y-auto px-4 pb-2 pt-5"
      style={{ width: PANEL_WIDTH, background: "var(--gryt-neutral-2)", borderRadius: "var(--gryt-radius-lg)" }}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <GroupFace host={host} conversation={conversation} self={self} size={72} />
        <h2 className="m-0 text-xl font-bold"><EmojiText text={conversation.name || conversation.members.map((m) => m.nickname).join(", ")} /></h2>
        <p className="m-0 text-[13px] text-gryt-muted">Anybody here can rename it or add people.</p>
        <Button size="small" tone="neutral" onClick={onEdit}>Edit group</Button>
      </div>
      <section className="flex flex-col gap-1">
        <Heading title="Members" detail={`${conversation.members.length + 1} with you`} />
        {conversation.members.map((p) => {
          const m = memberList?.[p.server_user_id];
          const status = m?.status;
          return (
            <div key={p.server_user_id} className="flex items-center gap-2.5 px-0.5 py-1.5">
              <span className="relative inline-flex shrink-0">
                <Avatar size="small" fallback={p.nickname[0]} src={resolveAvatarSrc(p.avatar_file_id ? getUploadsFileUrl(host, p.avatar_file_id, { thumb: true }) : undefined, p.nickname, p.avatar_worn)} />
                {status && (
                  <span className="absolute rounded-(--gryt-radius-full)" style={{ bottom: -1, right: -1, padding: 2, background: "var(--gryt-neutral-2)" }}>
                    <PresenceDot status={status} size={9} />
                  </span>
                )}
              </span>
              <span className="truncate text-sm font-semibold"><EmojiText text={m?.nickname || p.nickname} /></span>
              {status && <span className="ml-auto text-xs" style={{ color: statusConfig[status].color }}>{statusConfig[status].label}</span>}
            </div>
          );
        })}
        <button type="button" onClick={onAdd} className="flex cursor-pointer items-center gap-2 border-0 bg-transparent px-0.5 py-1.5 text-left text-sm font-semibold text-gryt-accent-light hover:text-gryt-text">
          <PiPlus size={16} /> Add someone
        </button>
      </section>
      <SharedFiles host={host} conversationId={conversation.conversation_id} />
      <button type="button" onClick={onLeave} className={`${footerButton} text-gryt-danger hover:opacity-80`}>
        <PiDoorOpenBold size={16} /> Leave group
      </button>
    </aside>
  );
}
