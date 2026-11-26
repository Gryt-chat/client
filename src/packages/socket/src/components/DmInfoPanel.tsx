import type { DirectConversation } from "@gryt/core";
import { Avatar, Button, ContextMenu, Menu } from "@gryt/ui";
import { BellSlash } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { generatedAvatarColor, getOwnLevel, getUploadsFileUrl, identityScopeFor, type NotificationLevel, openAttachment, openLocalArchive, resolveAvatarSrc, type SealedAttachmentKey, setNotificationLevel, subscribeToPrefs, useTheme } from "@/common";

import { PiArchiveFill, PiBellFill, PiDoorOpenBold,PiEyeSlashFill, PiFileFill, PiLockFill, PiMagnifyingGlassBold, PiPlayFill, PiPlus } from "../../../../lib/icons";
import type { usePins } from "../hooks/usePins";
import { cardProfileFor } from "../lib/memberCard/generatedCard";
import { fetchSealedAttachment } from "../utils/sealedAttachments";
import { EmojiText } from "./EmojiText";
import { GroupFace } from "./GroupFace";
import { ImageLightbox } from "./ImageLightbox";
import { MemberCardView } from "./memberCard/MemberCardView";
import { MemberIdentityCard } from "./MemberIdentityCard";
import type { MemberInfo } from "./MemberSidebar";
import { statusConfig } from "./memberStatus";
import { PresenceDot } from "./PresenceDot";

export const PANEL_WIDTH = 336;
const THUMBS = 6;

interface SharedFile {
  fileId: string;
  messageId: string;
  name: string | null;
  kind: "image" | "video" | null;
}

function kindOf(mime: string | undefined): SharedFile["kind"] {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  return null;
}

/**
 * Files in a conversation, as this device holds them, newest first. A file is decrypted only when something
 * shows it, and each once; nothing is asked of the server but the bytes.
 */
function useSharedFiles(host: string, conversationId: string) {
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const keys = useRef(new Map<string, SealedAttachmentKey>());
  const pending = useRef(new Map<string, Promise<void>>());
  const made = useRef<string[]>([]);

  useEffect(() => {
    let live = true;
    keys.current = new Map();
    pending.current = new Map();
    setFiles([]);
    setUrls({});
    void openLocalArchive()
      .then(async (archive) => {
        const scope = identityScopeFor(host);
        const found: SharedFile[] = [];
        let before: { sentAt: number; messageId: string } | undefined;
        for (;;) {
          const page = await archive.messages.page(scope, conversationId, { before, limit: 500 });
          for (const m of [...page].reverse()) {
            for (const [fileId, key] of Object.entries(m.attachments)) {
              keys.current.set(fileId, key);
              found.push({ fileId, messageId: m.messageId, name: key.name ?? null, kind: kindOf(key.mime) });
            }
          }
          if (page.length < 500) break;
          before = { sentAt: page[0].sentAt, messageId: page[0].messageId };
        }
        if (live) setFiles(found);
      })
      .catch(() => {
        // No archive here: the section reads as no files, which is what this device holds.
      });
    return () => {
      live = false;
      made.current.forEach((url) => URL.revokeObjectURL(url));
      made.current = [];
    };
  }, [host, conversationId]);

  const decrypt = useCallback((fileId: string) => {
    const key = keys.current.get(fileId);
    if (!key || pending.current.has(fileId)) return;
    pending.current.set(
      fileId,
      fetchSealedAttachment({
        url: getUploadsFileUrl(host, fileId),
        key,
        openFile: (ciphertext, meta) => openAttachment({ ciphertext, conversationId, meta }),
      })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          made.current.push(url);
          setUrls((prev) => ({ ...prev, [fileId]: url }));
        })
        .catch(() => {}),
    );
  }, [host, conversationId]);

  return { files, urls, decrypt };
}

/** Every picture and video in the conversation, oldest first; each one is opened as you get near it. */
function SharedGallery({ media, start, urls, decrypt, onClose }: {
  media: SharedFile[];
  start: number;
  urls: Record<string, string>;
  decrypt: (fileId: string) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  useEffect(() => {
    for (let i = index - 2; i <= index + 2; i++) if (media[i]) decrypt(media[i].fileId);
  }, [index, media, decrypt]);
  const gallery = useMemo(
    () => ({
      items: media.map((m) => ({ kind: m.kind ?? "image", name: m.name ?? (m.kind === "video" ? "Video" : "Image"), local: urls[m.fileId] ?? "" })),
      index: start,
    }),
    [media, urls, start],
  );
  return <ImageLightbox gallery={gallery} onIndexChange={setIndex} onClose={onClose} />;
}

function Heading({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex items-baseline px-0.5">
      <h3 className="m-0 text-[13px] font-bold text-gryt-neutral-11">{title}</h3>
      {detail && <span className="ml-auto text-xs text-gryt-muted">{detail}</span>}
    </div>
  );
}

function SharedFiles({ host, conversationId, onJump }: { host: string; conversationId: string; onJump: (messageId: string) => void }) {
  const { files, urls, decrypt } = useSharedFiles(host, conversationId);
  const newest = useMemo(() => files.slice(0, THUMBS), [files]);
  const media = useMemo(() => files.filter((f) => f.kind).reverse(), [files]);
  const [opened, setOpened] = useState<number | null>(null);

  useEffect(() => {
    for (const f of newest) if (f.kind === "image") decrypt(f.fileId);
  }, [newest, decrypt]);

  return (
    <section className="flex flex-col gap-2">
      <Heading title="Shared files" detail={`${files.length} on this device`} />
      {files.length === 0 ? (
        <p className="m-0 px-0.5 text-xs text-gryt-muted">Nothing shared that this device has.</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {newest.map((f) => (
            <ContextMenu.Root key={f.fileId}>
              <ContextMenu.Trigger
                render={
                  <button
                    type="button"
                    title={f.name ?? undefined}
                    aria-label={f.name ?? "Shared file"}
                    onClick={() => (f.kind ? setOpened(media.findIndex((m) => m.fileId === f.fileId)) : onJump(f.messageId))}
                    className="flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-(--gryt-radius-md) border-0 bg-gryt-neutral-4 p-0 hover:opacity-85"
                  />
                }
              >
                {f.kind === "image" && urls[f.fileId] && <img src={urls[f.fileId]} alt="" className="h-full w-full object-cover" />}
                {f.kind === "video" && <PiPlayFill size={20} style={{ color: "var(--gryt-accent-11)" }} />}
                {(!f.kind || (f.kind === "image" && !urls[f.fileId])) && <PiFileFill size={20} style={{ color: "var(--gryt-accent-11)" }} />}
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Positioner>
                  <ContextMenu.Popup>
                    <ContextMenu.Item onClick={() => onJump(f.messageId)}>Go to message</ContextMenu.Item>
                  </ContextMenu.Popup>
                </ContextMenu.Positioner>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          ))}
        </div>
      )}
      {opened !== null && opened >= 0 && (
        <SharedGallery media={media} start={opened} urls={urls} decrypt={decrypt} onClose={() => setOpened(null)} />
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

const OPTION_CLASS = "flex h-[38px] w-full cursor-pointer items-center gap-2.5 rounded-(--gryt-radius-full) border-0 bg-transparent px-2.5 text-left text-sm text-gryt-neutral-11 hover:bg-gryt-neutral-3 hover:text-gryt-text disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-gryt-neutral-11";

const LEVEL_LABEL: Record<NotificationLevel, string> = { all: "Everything", mentions: "Only mentions", none: "Muted" };

/** This DM's own level, with the same choices as its right-click menu. Only mentions is for groups. */
function NotificationsOption({ host, conversationId }: { host: string; conversationId: string }) {
  const read = () => getOwnLevel(host, { kind: "channel", id: conversationId }) ?? "all";
  const level = useSyncExternalStore(subscribeToPrefs, read, read);
  const choices: [NotificationLevel, string][] = [
    ["all", "Everything"],
    ...(conversationId.startsWith("dm_g") ? [["mentions", "Only mentions"] as [NotificationLevel, string]] : []),
    ["none", "Nothing"],
  ];
  return (
    <Menu.Root>
      <Menu.Trigger render={<button type="button" className={OPTION_CLASS} />}>
        <span className="flex text-gryt-muted">{level === "none" ? <BellSlash weight="fill" size={16} /> : <PiBellFill size={16} />}</span>
        <span className="flex-1">Notifications</span>
        <span className="text-xs text-gryt-muted">{LEVEL_LABEL[level]}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end">
          <Menu.Popup aria-label="Notifications">
            <Menu.RadioGroup
              value={level}
              onValueChange={(value) =>
                setNotificationLevel(host, { kind: "channel", id: conversationId }, value === "all" ? null : (value as NotificationLevel))
              }
            >
              {choices.map(([value, label]) => (
                <Menu.RadioItem key={value} value={value} closeOnClick>
                  {label}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Option({ icon, label, detail, onClick }: { icon: ReactNode; label: string; detail?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={OPTION_CLASS}>
      <span className="flex text-gryt-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {detail && <span className="text-xs text-gryt-muted">{detail}</span>}
    </button>
  );
}

function MiniCard({ member, host, statusText, onFullCard }: { member: MemberInfo; host: string; statusText?: string; onFullCard: () => void }) {
  const { resolvedAppearance } = useTheme();
  const profile = useMemo(
    () => cardProfileFor(member, member.nickname),
    // The fields, not the member object, which is new on every list update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [member.cardStyle, member.bio, member.pronouns, member.statusLine, member.nickname],
  );
  const video = member.avatarVideo && !member.avatarWorn;
  return (
    <MemberCardView
      compact
      name={member.nickname}
      avatarSrc={resolveAvatarSrc(member.avatarFileId ? getUploadsFileUrl(host, member.avatarFileId) : undefined, member.nickname, member.avatarWorn)}
      avatarType={video ? "video" : "image"}
      avatarPoster={video && member.avatarFileId ? getUploadsFileUrl(host, member.avatarFileId, { thumb: true }) : null}
      status={member.status}
      statusText={statusText}
      profile={profile}
      owlHex={generatedAvatarColor(member.nickname, member.avatarWorn) ?? member.avatarColor ?? "#7c5cff"}
      bannerType={member.bannerVideo ? "video" : "image"}
      bannerUrl={member.bannerFileId ? getUploadsFileUrl(host, member.bannerFileId) : null}
      appearance={resolvedAppearance}
      seedKey={member.serverUserId}
      worn={member.avatarWorn}
      isBot={member.isBot}
    >
      <button type="button" onClick={onFullCard} className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-inherit underline">
        Full card
      </button>
    </MemberCardView>
  );
}

/** Board D1: their card as one row, then the options laid out bare, then what this conversation holds. */
export function DmPersonPanel({
  host, member, conversation, pins, memberList, onJump, onHide, onSearch, onImport, importSection, reencryptProgress,
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
  reencryptProgress?: { done: number; total: number } | null;
}) {
  const [fullCard, setFullCard] = useState(false);
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
      {/* shrink-0: the card clips its overflow, so in this flex column it was squeezed and cut off instead of the panel scrolling. */}
      {fullCard && member && <div className="shrink-0"><MemberIdentityCard member={member} serverHost={host} inline /></div>}
      {!fullCard && member && <div className="shrink-0"><MiniCard member={member} host={host} statusText={where || undefined} onFullCard={() => setFullCard(true)} /></div>}
      {!member && (
        <div
          className="flex items-center gap-3 p-3"
          style={{ borderRadius: 20, background: "linear-gradient(135deg, color-mix(in oklab, var(--gryt-accent-9) 22%, var(--gryt-neutral-3)), var(--gryt-neutral-3) 70%)" }}
        >
          <Avatar size="large" fallback={name[0]} src={resolveAvatarSrc(conversation.other.avatar_file_id ? getUploadsFileUrl(host, conversation.other.avatar_file_id, { thumb: true }) : undefined, conversation.other.nickname, conversation.other.avatar_worn)} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[17px] font-bold"><EmojiText text={name} /></span>
          </span>
        </div>
      )}
      {fullCard && member && (
        <button type="button" onClick={() => setFullCard(false)} className="gryt-link -mt-1 cursor-pointer self-end border-0 bg-transparent px-2 text-xs">
          Show less
        </button>
      )}
      <div className="flex flex-col gap-4 px-1.5">
        <div className="flex flex-col gap-0.5">
          <Option icon={<PiMagnifyingGlassBold size={16} />} label="Search in this chat" onClick={onSearch} />
          <Option icon={<PiArchiveFill size={16} />} label="Import from Discord" onClick={onImport} />
          <NotificationsOption host={host} conversationId={conversation.conversation_id} />
          {reencryptProgress && <Option icon={<PiLockFill size={16} />} label="Encrypting older messages" detail={`${reencryptProgress.done} of ${reencryptProgress.total}`} />}
        </div>
        {importSection}
        <Pinned pins={pins} memberList={memberList} onJump={onJump} />
        <SharedFiles host={host} conversationId={conversation.conversation_id} onJump={onJump} />
      </div>
      <button type="button" onClick={onHide} className={`${footerButton} mx-2 text-gryt-neutral-11 hover:text-gryt-text`}>
        <PiEyeSlashFill size={16} /> Hide conversation
      </button>
    </aside>
  );
}

/** Board 3: the group's face and name, who's in it, and what it holds. */
export function DmGroupPanel({
  host, conversation, self, memberList, onJump, onEdit, onAdd, onLeave,
}: {
  host: string;
  conversation: DirectConversation;
  self?: DirectConversation["other"];
  memberList?: Record<string, MemberInfo>;
  onJump: (messageId: string) => void;
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
      <SharedFiles host={host} conversationId={conversation.conversation_id} onJump={onJump} />
      <button type="button" onClick={onLeave} className={`${footerButton} text-gryt-danger hover:opacity-80`}>
        <PiDoorOpenBold size={16} /> Leave group
      </button>
    </aside>
  );
}
