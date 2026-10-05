import { CardIcon, CardMenu, type CardMenuItem,Popover } from "@gryt/ui";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import {
  comparisonCode,
  generatedAvatarColor,
  getOwnServerUserId,
  getUploadsFileUrl,
  identityScopeFor,
  markPeerCompared,
  ownComparisonSide,
  resolveAvatarSrc,
  useTheme,
} from "@/common";
import { useSettings } from "@/settings";

import { openLightbox } from "../../../../lib/lightboxStore";
import { confirmServerFriend, friendAction, useAllFriends, useFriendState } from "../hooks/friendsStore";
import { useServerPermissions } from "../hooks/usePermissions";
import { useSockets } from "../hooks/useSockets";
import { encodeCardStyle } from "../lib/memberCard/cardStyle";
import { cardProfileFor } from "../lib/memberCard/generatedCard";
import { formatJoined, makeRankOf, TIER_LABEL } from "../lib/memberFacts";
import { friendButtonSteps, type FriendStep } from "../utils/friendButtonSteps";
import { describeChange, describePin } from "../utils/memberKeyWording";
import { ConfirmDialog } from "./ConfirmDialog";
import { useMemberCardActions } from "./memberCard/memberCardContext";
import { MemberCardView } from "./memberCard/MemberCardView";
import type { MemberInfo } from "./MemberSidebar";

/** The colour a card starts from when the owl cannot be drawn: Gryt's own violet. */
const FALLBACK_OWL = "#7c5cff";

/** A rename by when and how often, never by what it used to say. */
function describeRenames(count?: number, at?: string | null): string | null {
  if (!count || count < 1) return null;

  const times = count === 1 ? "Renamed once" : `Renamed ${count} times`;
  if (!at) return times;

  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return times;

  const minutes = Math.floor((Date.now() - when.getTime()) / 60_000);
  if (minutes < 60) return `${times}, last just now`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${times}, last ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) return `${times}, last ${days} day${days === 1 ? "" : "s"} ago`;

  return `${times}, last ${when.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}`;
}

/** Grouped in fours and never shortened: a few characters could be ground out to match. */
function Fingerprint({ value }: { value: string }) {
  return <code className="gmc-code">{value.replace(/(.{4})(?=.)/g, "$1 ")}</code>;
}

const copy = (text: string, done: string) =>
  void navigator.clipboard.writeText(text).then(
    () => toast.success(done),
    () => toast.error("Could not copy"),
  );

const STEP_ICON: Record<FriendStep["icon"], () => ReactElement> = {
  add: CardIcon.friend,
  clock: CardIcon.clock,
  check: CardIcon.check,
  close: CardIcon.close,
  confirm: CardIcon.friend,
};

export function MemberIdentityCard({
  member,
  serverHost,
  voiceChannelName,
}: {
  member: MemberInfo;
  /** Which server this member is shown on, for their key state, roles and uploads. */
  serverHost?: string;
  /** Looked up from the member's channel when a caller does not pass it. */
  voiceChannelName?: string;
}) {
  const actions = useMemberCardActions();
  const { memberKeyStates, serverDetailsList } = useSockets();
  const { roles: roleSummaries, has, can } = useServerPermissions(serverHost ?? "");
  const { resolvedAppearance } = useTheme();
  const { openSettings } = useSettings();

  // Every role, not only the one their name is coloured by; `roles` absent is an older server.
  const rolePills = (member.roles ?? (member.role ? [member.role] : []))
    // The two joiner defaults say only that nobody has given them anything. GRYT-1076.
    .filter((role) => role && role !== "member" && role !== "guest")
    // The name the rest of the app shows, or the id where the server sent none.
    .map((role) => ({ id: role, name: roleSummaries.find((r) => r.id === role)?.name ?? role }));
  const [, setCompared] = useState(false);
  const [ownKeys, setOwnKeys] = useState<{ thumbprint: string; dmPublicKey: string } | null>(null);
  const keyState = serverHost ? memberKeyStates[serverHost]?.[member.serverUserId] : undefined;

  /* Our own half of the comparison code, which needs what we published here. */
  useEffect(() => {
    if (!serverHost) {
      setOwnKeys(null);
      return;
    }
    let live = true;
    void ownComparisonSide(serverHost)
      .then((side) => {
        if (live) setOwnKeys(side);
      })
      .catch(() => {
        if (live) setOwnKeys(null);
      });
    return () => {
      live = false;
    };
  }, [serverHost]);

  const code =
    ownKeys && keyState?.decision.kind === "known"
      ? comparisonCode(ownKeys, {
          thumbprint: keyState.decision.pin.thumbprint,
          dmPublicKey: keyState.decision.pin.dmPublicKey,
        })
      : null;

  const profile = useMemo(
    () => cardProfileFor(member, member.nickname),
    // The fields, not the member object, which is new on every list update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [member.cardStyle, member.bio, member.pronouns, member.statusLine, member.nickname],
  );
  const joined = formatJoined(member.createdAt);
  const tier = member.identityTier ? TIER_LABEL[member.identityTier] : undefined;
  const renames = describeRenames(member.nicknameChangeCount, member.nicknameChangedAt);
  const offline = member.status === "offline";
  const isSelf =
    member.serverUserId === (actions.currentServerUserId ?? getOwnServerUserId(serverHost));

  // Only a designed owl can be copied; copying somebody's photograph would be impersonation.
  const worn = member.avatarWorn;
  const owlHex = generatedAvatarColor(member.nickname, member.avatarWorn) ?? member.avatarColor ?? FALLBACK_OWL;
  const channelName =
    voiceChannelName ??
    (serverHost && member.voiceChannelId
      ? serverDetailsList[serverHost]?.channels?.find((c) => c.id === member.voiceChannelId)?.name
      : undefined);

  const [open, setOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const identityIsTheQuestion = member.identityTier === "local";
  const fingerprint = member.identityFingerprint;

  /* The friend step, as the sidebar's FriendButton works it out, drawn as icon buttons. */
  const friendState = useFriendState(serverHost, isSelf || member.isBot ? undefined : member.serverUserId);
  const allFriends = useAllFriends();
  const [pendingStep, setPendingStep] = useState<FriendStep | null>(null);
  const hostFriends = allFriends.find((h) => h.host === serverHost);
  const person =
    hostFriends?.friends.find((p) => p.serverUserId === member.serverUserId) ??
    hostFriends?.incoming.find((p) => p.serverUserId === member.serverUserId) ??
    hostFriends?.outgoing.find((p) => p.serverUserId === member.serverUserId);
  const friendSteps = serverHost && friendState ? friendButtonSteps(friendState, member.nickname) : [];
  const runStep = (step: FriendStep) => {
    if (!serverHost) return;
    if (step.action === "confirm") {
      if (person) confirmServerFriend(serverHost, person);
    } else {
      friendAction(serverHost, step.action, member.serverUserId);
    }
  };

  /* Moderation, gated exactly as UserContextMenu gates it: rank decides who, permission what. */
  const admin = actions.adminActions;
  const rankOf = makeRankOf(roleSummaries);
  const myRole = actions.currentUserRole;
  const outranksTarget = !!myRole && !!member.role && rankOf(myRole) > rankOf(member.role);
  const canMute = has("mute_members") && outranksTarget && !!admin?.onServerMuteUser;
  const canDeafen = has("deafen_members") && outranksTarget && !!admin?.onServerDeafenUser;
  const canKick = has("kick_members") && outranksTarget && !!admin?.onKickUser;
  const canBan = has("ban_members") && outranksTarget && !!admin?.onBanUser;
  const heldRoles = member.roles ?? (member.role ? [member.role] : []);
  const assignableRoles = roleSummaries
    .filter((r) => r.id !== "owner" && r.rank < rankOf(myRole))
    .sort((a, b) => b.rank - a.rank);
  const canAssignRoles =
    has("manage_roles") && outranksTarget && !!admin?.onToggleRole && assignableRoles.length > 0;
  const inVoice = member.hasJoinedChannel;
  const canDisconnect = !!admin?.onDisconnectUser && inVoice;
  const showMod = !isSelf && (canMute || canDeafen || canKick || canBan || canAssignRoles || canDisconnect);

  const blocked = actions.isBlocked?.(member.serverUserId) ?? false;
  const moreItems: CardMenuItem[] = [
    { key: "id", label: "Copy ID", onSelect: () => copy(member.serverUserId, "Copied user ID") },
    ...(!isSelf && actions.onToggleBlock
      ? [{ key: "block", label: blocked ? "Unblock" : "Block", danger: !blocked, onSelect: () => actions.onToggleBlock!(member.serverUserId) }]
      : []),
    {
      key: "style",
      label: "Copy card style",
      divider: true,
      onSelect: () => copy(encodeCardStyle(profile.cardStyle), "Card style copied. Paste it in Edit my card to use it."),
    },
  ];

  const chips = [
    ...rolePills,
    // Amber marks "no account" and nothing else, so it keeps meaning something.
    ...(tier?.amber ? [{ id: "tier", name: tier.label, amber: true }] : []),
  ];

  const avatarSrc = resolveAvatarSrc(
    member.avatarFileId && serverHost ? getUploadsFileUrl(serverHost, member.avatarFileId) : undefined,
    member.nickname,
    member.avatarWorn,
  );

  return (
    <MemberCardView
      name={member.nickname}
      avatarSrc={avatarSrc}
      avatarType={member.avatarVideo && !member.avatarWorn ? "video" : "image"}
      avatarPoster={member.avatarVideo && member.avatarFileId && serverHost ? getUploadsFileUrl(serverHost, member.avatarFileId, { thumb: true }) : null}
      // The lightbox shows pictures, so a video avatar opens its still poster there.
      onAvatarClick={avatarSrc ? () => openLightbox({
        src: member.avatarVideo && !member.avatarWorn && member.avatarFileId && serverHost ? getUploadsFileUrl(serverHost, member.avatarFileId, { thumb: true }) : avatarSrc,
        alt: member.nickname,
      }) : undefined}
      status={member.status}
      channelName={channelName}
      isBot={member.isBot}
      profile={profile}
      owlHex={owlHex}
      bannerType={member.bannerVideo ? "video" : "image"}
      bannerUrl={member.bannerFileId && serverHost ? getUploadsFileUrl(serverHost, member.bannerFileId) : null}
      game={offline ? null : member.richActivity}
      chips={chips}
      appearance={resolvedAppearance}
      seedKey={member.serverUserId}
      worn={member.avatarWorn}
      menuOpen={menuOpen}
    >
      {identityIsTheQuestion && fingerprint && (
        <div className="gmc-sub" style={{ marginTop: 0 }}>
          <span className="gmc-note">Fingerprint</span>
          <Fingerprint value={fingerprint} />
          <span className="gmc-note">Names are not unique. Check the fingerprint if it matters.</span>
        </div>
      )}

      <div className="gmc-acts">
        {!isSelf && actions.onOpenDm && can("send_direct_messages") && (
          <Popover.Close
            render={<button type="button" className="gmc-ib" aria-label="Message" data-tip="Message" />}
            onClick={() => actions.onOpenDm!(member.serverUserId)}
          >
            <CardIcon.chat />
          </Popover.Close>
        )}
        {friendSteps.map((step, i) => {
          const Icon = STEP_ICON[step.icon];
          return (
            <button
              key={step.action}
              type="button"
              className={i === 0 ? "gmc-ib" : "gmc-ib quiet"}
              aria-label={step.hint}
              data-tip={step.label}
              data-gryt="friend-button"
              data-state={step.action}
              onClick={() => (step.confirm ? setPendingStep(step) : runStep(step))}
            >
              <Icon />
            </button>
          );
        })}
        {!isSelf && (
          <Popover.Close
            render={<button type="button" className="gmc-ib quiet" aria-label="Mention" data-tip="Mention" />}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("mention_user", { detail: { serverUserId: member.serverUserId, nickname: member.nickname } }),
              )
            }
          >
            <CardIcon.at />
          </Popover.Close>
        )}
        {worn && (
          <button type="button" className="gmc-ib quiet" aria-label="Copy avatar" data-tip="Copy avatar" onClick={() => copy(worn, "Avatar code copied")}>
            <CardIcon.copy />
          </button>
        )}
        {isSelf && (
          <Popover.Close
            render={<button type="button" className="gmc-ib quiet" aria-label="Edit my card" data-tip="Edit my card" />}
            onClick={() => openSettings("profile/card")}
          >
            <CardIcon.pen />
          </Popover.Close>
        )}
        <span className="sp" />
        {!isSelf && actions.onReport && has("report_messages") && (
          <button
            type="button"
            className="gmc-ib danger"
            aria-label="Report"
            data-tip="Report"
            onClick={() => actions.onReport!({ serverUserId: member.serverUserId, nickname: member.nickname })}
          >
            <CardIcon.flag />
          </button>
        )}
        <CardMenu className="gmc-ib quiet more" tip="More" icon={<CardIcon.more />} items={moreItems} onOpenChange={setMenuOpen} />
      </div>

      {showMod && admin && (
        <div className="gmc-mod">
          <div className="gmc-mod-h">
            <span>Moderation</span>
            {outranksTarget && <span>You outrank them</span>}
          </div>
          <div className="gmc-acts">
            {canAssignRoles && (
              <CardMenu
                className="gmc-ib text"
                tip="Give or take roles"
                icon={<CardIcon.roles />}
                label={<> Roles <CardIcon.caret /></>}
                align="left"
                onOpenChange={setMenuOpen}
                items={assignableRoles.map((r) => {
                  const holds = heldRoles.includes(r.id);
                  return { key: r.id, label: r.name, checked: holds, onSelect: () => admin.onToggleRole!(member.serverUserId, r.id, !holds) };
                })}
              />
            )}
            {inVoice && canMute && (
              <button
                type="button"
                className={member.isServerMuted ? "gmc-ib on" : "gmc-ib"}
                aria-label={member.isServerMuted ? "Remove server mute" : "Server mute"}
                aria-pressed={!!member.isServerMuted}
                data-tip={member.isServerMuted ? "Remove server mute" : "Server mute"}
                onClick={() => admin.onServerMuteUser!(member.serverUserId, !member.isServerMuted)}
              >
                <CardIcon.mic />
              </button>
            )}
            {inVoice && canDeafen && (
              <button
                type="button"
                className={member.isServerDeafened ? "gmc-ib on" : "gmc-ib"}
                aria-label={member.isServerDeafened ? "Remove server deafen" : "Server deafen"}
                aria-pressed={!!member.isServerDeafened}
                data-tip={member.isServerDeafened ? "Remove server deafen" : "Server deafen"}
                onClick={() => admin.onServerDeafenUser!(member.serverUserId, !member.isServerDeafened)}
              >
                <CardIcon.deaf />
              </button>
            )}
            {canDisconnect && (
              <button type="button" className="gmc-ib" aria-label="Disconnect from voice" data-tip="Disconnect from voice" onClick={() => admin.onDisconnectUser!(member.serverUserId)}>
                <CardIcon.disc />
              </button>
            )}
            <span className="sp" />
            {canKick && (
              <button type="button" className="gmc-ib danger" aria-label="Kick from server" data-tip="Kick from server" onClick={() => admin.onKickUser!(member.serverUserId)}>
                <CardIcon.kick />
              </button>
            )}
            {canBan && (
              <button type="button" className="gmc-ib danger" aria-label="Ban from server" data-tip="Ban from server" onClick={() => admin.onBanUser!(member.serverUserId)}>
                <CardIcon.ban />
              </button>
            )}
          </div>
        </div>
      )}

      <details
        className="gmc-who"
        open={open}
        onToggle={(e) => {
          const next = (e.currentTarget as HTMLDetailsElement).open;
          setOpen(next);
          if (!next) setVerifyOpen(false);
        }}
      >
        <summary>
          Who they are <CardIcon.caret />
        </summary>
        <dl>
          {tier && (
            <>
              <dt>Account</dt>
              <dd>{tier.label}</dd>
            </>
          )}
          {joined && (
            <>
              <dt>Joined</dt>
              <dd>{joined}</dd>
            </>
          )}
          {renames && (
            <>
              <dt>Name</dt>
              <dd>{renames}</dd>
            </>
          )}
          {keyState?.decision.kind === "known" && (
            <>
              <dt>Message key</dt>
              <dd>{keyState.decision.pin.comparedAt ? "Compared and matched" : describePin(keyState.decision.pin.firstSeenAt)}</dd>
            </>
          )}
          {keyState?.decision.kind === "first" && (
            <>
              <dt>Message key</dt>
              <dd>Seen for the first time</dd>
            </>
          )}
        </dl>
        {keyState?.decision.kind === "changed" && (
          // In the drawer and not a toast, which would be gone before anybody asked them.
          <div className="gmc-warn" style={{ marginTop: 10 }}>
            <b>Their key changed</b>
            <span className="gmc-note">{describeChange(keyState.decision.changedIdentity, keyState.decision.changedKey)}</span>
            <span className="gmc-note">
              That happens when somebody restores their identity on another device. It is also what a server
              substituting a key looks like. Ask them somewhere other than here before treating messages as private.
            </span>
          </div>
        )}
        {(code || (!identityIsTheQuestion && fingerprint)) && (
          <details
            className="gmc-who gmc-sub"
            open={verifyOpen}
            onToggle={(e) => setVerifyOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>
              Check this is really them <CardIcon.caret />
            </summary>
            {code && keyState?.decision.kind === "known" && (
              <>
                <span className="gmc-note">Read this to them, somewhere other than Gryt</span>
                <code className="gmc-code" style={{ textAlign: "center", letterSpacing: ".06em" }}>{code}</code>
                <span className="gmc-note">
                  If they read back the same numbers, nobody is in the middle. It does not say who they are, only that
                  you both hold the keys you think you do.
                </span>
                {keyState.decision.pin.comparedAt ? (
                  <span className="gmc-note">
                    Compared on{" "}
                    {new Date(keyState.decision.pin.comparedAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                    .
                  </span>
                ) : (
                  <button
                    type="button"
                    className="gmc-btn"
                    onClick={() => {
                      if (
                        !serverHost ||
                        keyState.decision.kind !== "known" ||
                        !markPeerCompared(identityScopeFor(serverHost), member.serverUserId, {
                          thumbprint: keyState.decision.pin.thumbprint,
                          dmPublicKey: keyState.decision.pin.dmPublicKey,
                        })
                      ) {
                        // The pin moved while they were reading, so say so rather than record a false match.
                        toast.error("Their key changed while you were checking. Read the new code.");
                        return;
                      }
                      setCompared(true);
                      toast.success("Marked as compared.");
                    }}
                  >
                    They read back the same
                  </button>
                )}
              </>
            )}
            {!identityIsTheQuestion && fingerprint && (
              <>
                <span className="gmc-note">Fingerprint</span>
                <Fingerprint value={fingerprint} />
                <span className="gmc-note">Names are not unique. Check the fingerprint if it matters.</span>
              </>
            )}
          </details>
        )}
      </details>

      <ConfirmDialog
        open={!!pendingStep}
        onOpenChange={(next) => {
          if (!next) setPendingStep(null);
        }}
        title={pendingStep?.confirm?.title ?? ""}
        description={pendingStep?.confirm?.description}
        confirmLabel={pendingStep?.confirm?.confirmLabel ?? "Confirm"}
        cancelLabel={pendingStep?.confirm?.cancelLabel ?? "Cancel"}
        confirmTone="primary"
        onConfirm={() => {
          if (pendingStep) runStep(pendingStep);
        }}
      />
    </MemberCardView>
  );
}
