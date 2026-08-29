import { Avatar, Button, Chip, Collapsible } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { PiCaretDownBold, PiCopySimpleBold } from "react-icons/pi";

import {
  comparisonCode,
  identityScopeFor,
  markPeerCompared,
  ownComparisonSide,
  resolveAvatarSrc,
} from "@/common";

import { useSockets } from "../hooks/useSockets";
import { describeChange, describePin } from "../utils/memberKeyWording";
import { BotTag } from "./BotTag";
import type { MemberInfo } from "./MemberSidebar";
import { statusConfig } from "./memberStatus";

/**
 * What a member list can say about somebody beyond their chosen name.
 *
 * Nicknames are not unique and never have been, so "Sivert" in the sidebar is a
 * claim rather than a fact. These are the parts of that claim nobody can pick:
 * when the account first joined *this* server, whether there is an account
 * behind it at all, and a marker that stays the same across renames.
 *
 * Presence first, identity on demand. Hovering somebody mid-call is nearly
 * always a question about where they are rather than an audit, so the ring, the
 * name and the status answer it without a click and everything that proves who
 * they are sits in a drawer underneath.
 *
 * The exception is a member with no account, where the question on hover really
 * is identity. There the fingerprint comes out of the drawer and stays on the
 * face of the card.
 */

function formatJoined(value?: string | Date): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const TIER_LABEL: Record<string, { label: string; amber: boolean }> = {
  account: { label: "Gryt account", amber: false },
  local: { label: "No account", amber: true },
};

/**
 * A rename described by when and how often, never by what it used to say.
 *
 * A recent rename is the thing worth noticing — an account that became this
 * name an hour ago is worth a second look in a way that one which has held it
 * for a year is not. Past names would answer a question nobody is asking here,
 * at the cost of publishing something somebody may have had a good reason to
 * change.
 */
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

/**
 * Grouped in fours, and never shortened.
 *
 * A local identity is a keypair its holder makes, so a few characters could be
 * ground out to match somebody worth impersonating — the server keys the
 * fingerprint so that cannot be done offline, and the full value is what makes
 * comparing it mean anything. Four authoritative-looking characters would be
 * worse than none: they invite a comparison that does not hold.
 *
 * The groups are for reading it aloud, which is how two people actually check
 * one against the other.
 */
function Fingerprint({ value }: { value: string }) {
  return (
    <code
      className="block rounded-(--gryt-radius-sm) border border-gryt-border bg-gryt-bg px-2 py-1.5 font-mono text-xs text-gryt-text"
      style={{ wordSpacing: "0.35em", overflowWrap: "anywhere", userSelect: "all" }}
    >
      {value.replace(/(.{4})(?=.)/g, "$1 ")}
    </code>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs text-gryt-muted">{label}</dt>
      <dd className="m-0 text-right text-sm text-gryt-text">{children}</dd>
    </>
  );
}

export function MemberIdentityCard({
  member,
  serverHost,
  voiceChannelName,
}: {
  member: MemberInfo;
  /**
   * Which server this member is being shown on, so their key state can be
   * looked up (GRYT-728).
   *
   * Read from the hook here rather than passed down, because both callers —
   * the sidebar and a message row — would otherwise have to thread it through
   * components that have no other use for it, and one of them forgetting is a
   * card that quietly stops mentioning a changed key.
   *
   * Optional, and without it the key section is simply absent. Same as a server
   * too old to carry bindings at all.
   */
  serverHost?: string;
  /**
   * Optional, because neither caller has channels in reach: the sidebar and the
   * message list both pass a member and nothing else. Without it the status
   * reads "In Voice" rather than "In Voice · General", which is the part that
   * mattered anyway.
   */
  voiceChannelName?: string;
}) {
  const { memberKeyStates } = useSockets();
  // Only to redraw after marking one; the pin itself is the record.
  const [, setCompared] = useState(false);
  const [ownKeys, setOwnKeys] = useState<{ thumbprint: string; dmPublicKey: string } | null>(null);
  const keyState = serverHost
    ? memberKeyStates[serverHost]?.[member.serverUserId]
    : undefined;

  /*
   * Our own half of the code. Both sides go into it, so this card cannot draw
   * one until it knows what we published here — which is a derivation, not a
   * fetch, so it lands almost immediately.
   */
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

  const joined = formatJoined(member.createdAt);
  const tier = member.identityTier ? TIER_LABEL[member.identityTier] : undefined;
  const renames = describeRenames(
    member.nicknameChangeCount,
    member.nicknameChangedAt,
  );
  const status = statusConfig[member.status];
  const offline = member.status === "offline";

  /*
   * Only a designed owl can be copied. Copying somebody's uploaded photograph
   * would be impersonation, on the one card that exists to help people tell
   * each other apart.
   */
  const worn = member.avatarWorn;

  /*
   * The whole fingerprint on the face of the card when there is no account
   * behind the name, in the drawer when there is. This is the one place the
   * card stops being presence-first, and it is the case where the question on
   * hover really is "is this who I think it is".
   */
  const [open, setOpen] = useState(false);

  const identityIsTheQuestion = member.identityTier === "local";
  const fingerprint = member.identityFingerprint;

  const caution = (
    <span className="text-xs leading-snug text-gryt-muted">
      Names are not unique. Check the fingerprint if it matters.
    </span>
  );

  return (
    /* Full width of whatever it is dropped into, not a number of its own.
       This was 260px inside a popup that is `w-64` with `p-4` — 256 less 32 of
       padding, so 224 — and every row wider than that ran out past the card's
       edge. A card that sets its own width has to know the padding of a
       container it cannot see. */
    <div className="flex w-full min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {/*
          The ring is the presence rather than a dot beside it, so it reads
          before you have finished looking at the name. Offline gets no ring at
          all instead of a grey one — an absent person should be quiet, not
          marked.
        */}
        <span
          className="shrink-0 rounded-(--gryt-radius-full) p-[3px]"
          style={{ background: offline ? "transparent" : status.color }}
        >
          <Avatar
            alt=""
            fallback={member.nickname[0]}
            src={resolveAvatarSrc(undefined, member.nickname, member.avatarWorn)}
          />
        </span>

        <div className="flex min-w-0 flex-col gap-0.5">
          <span
            className="flex items-center gap-1.5 text-base font-bold"
            style={{ overflowWrap: "anywhere" }}
          >
            {member.nickname}
            {member.isBot && <BotTag size="small" />}
          </span>
          <span className="text-xs" style={{ color: status.color }}>
            {status.label}
            {member.status === "in_voice" && voiceChannelName && (
              <span className="text-gryt-muted"> · {voiceChannelName}</span>
            )}
          </span>
        </div>
      </div>

      {((member.role && member.role !== "member") || tier?.amber) && (
        <div className="flex flex-wrap gap-1.5">
          {member.role && member.role !== "member" && (
            <Chip tone="primary">{member.role}</Chip>
          )}
          {/*
            Amber marks "no account" and nothing else. Spend it anywhere
            decorative and it stops meaning anything.
          */}
          {tier?.amber && <Chip tone="warning">{tier.label}</Chip>}
        </div>
      )}

      {worn && (
        <Button
          onClick={() => {
            void navigator.clipboard
              .writeText(worn)
              .then(() => toast.success("Avatar code copied"))
              .catch(() => toast.error("Could not copy"));
          }}
          size="small"
          startIcon={<PiCopySimpleBold size={14} />}
        >
          Copy avatar
        </Button>
      )}

      {identityIsTheQuestion && fingerprint && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-gryt-muted">Fingerprint</span>
          <Fingerprint value={fingerprint} />
          {caution}
        </div>
      )}

      <Collapsible.Root onOpenChange={setOpen} open={open}>
        <Collapsible.Trigger className="cursor-pointer border-t border-gryt-border !px-0 pt-2.5 text-xs font-semibold text-gryt-muted hover:!bg-transparent hover:text-gryt-text">
          Who they are
          {/*
            Turned from state rather than a data-attribute variant. Base UI does
            put data-panel-open on the trigger, but the Tailwind variant for it
            compiled to nothing here and a caret that silently never turns is
            exactly the kind of thing that ships.
          */}
          <PiCaretDownBold
            className="transition-transform"
            size={10}
            style={{ transform: open ? "rotate(180deg)" : undefined }}
          />
        </Collapsible.Trigger>
        <Collapsible.Panel>
          <div className="flex flex-col gap-2.5 pt-2.5">
            <dl className="m-0 grid grid-cols-[auto_1fr] items-baseline gap-x-3.5 gap-y-1.5">
              {tier && <Fact label="Account">{tier.label}</Fact>}
              {joined && <Fact label="Joined">{joined}</Fact>}
              {renames && <Fact label="Name">{renames}</Fact>}
              {keyState?.decision.kind === "known" && (
                <Fact label="Message key">
                  {keyState.decision.pin.comparedAt
                    ? "Compared and matched"
                    : describePin(keyState.decision.pin.firstSeenAt)}
                </Fact>
              )}
              {keyState?.decision.kind === "first" && (
                <Fact label="Message key">Seen for the first time</Fact>
              )}
            </dl>
            {keyState?.decision.kind === "changed" && (
              /*
               * Inside the drawer with the rest of the identity facts, and
               * deliberately not a toast. A toast for this would be gone before
               * the person it concerns said anything, and there would be nothing
               * to go back to.
               */
              <div
                className="flex flex-col gap-1.5 rounded p-2.5 text-xs leading-snug"
                style={{
                  background: "var(--gryt-amber-3, var(--gryt-neutral-4))",
                  color: "var(--gryt-text)",
                }}
              >
                <span className="font-semibold">Their key changed</span>
                <span className="text-gryt-muted">
                  {describeChange(
                    keyState.decision.changedIdentity,
                    keyState.decision.changedKey,
                  )}
                </span>
                <span className="text-gryt-muted">
                  {/*
                    Both causes, neither picked. Saying "they probably got a new
                    device" would be a guess this client cannot make, and it is
                    the reassuring one of the two.
                  */}
                  That happens when somebody restores their identity on another
                  device. It is also what a server substituting a key looks
                  like. Ask them somewhere other than here before treating
                  messages as private.
                </span>
              </div>
            )}
            {code && keyState?.decision.kind === "known" && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-gryt-muted">
                  {/*
                    "Read this to them" rather than "verify". Nothing here is
                    verified by looking at it — the check happens somewhere this
                    server is not, and the wording has to point at that rather
                    than imply the card did it.
                  */}
                  Read this to them, somewhere other than Gryt
                </span>
                <code
                  className="select-all rounded p-2 text-center text-xs leading-relaxed tracking-wider"
                  style={{ background: "var(--gryt-neutral-4)", color: "var(--gryt-text)" }}
                >
                  {code}
                </code>
                <span className="text-xs leading-snug text-gryt-muted">
                  If they read back the same numbers, nobody is in the middle.
                  It does not say who they are — only that you both hold the
                  keys you think you do.
                </span>
                {keyState.decision.pin.comparedAt ? (
                  <span className="text-xs text-gryt-muted">
                    Compared on{" "}
                    {new Date(keyState.decision.pin.comparedAt).toLocaleDateString(
                      undefined,
                      { year: "numeric", month: "short", day: "numeric" },
                    )}
                    .
                  </span>
                ) : (
                  <Button
                    tone="neutral"
                    size="xsmall"
                    onClick={() => {
                      if (
                        !serverHost ||
                        keyState.decision.kind !== "known" ||
                        !markPeerCompared(
                          identityScopeFor(serverHost),
                          member.serverUserId,
                          {
                            thumbprint: keyState.decision.pin.thumbprint,
                            dmPublicKey: keyState.decision.pin.dmPublicKey,
                          },
                        )
                      ) {
                        // Refused because the pin moved between reading the code
                        // out and pressing this. Rare, and the honest answer is
                        // to say the code is stale rather than to record a
                        // comparison of keys nobody compared.
                        toast.error("Their key changed while you were checking. Read the new code.");
                        return;
                      }
                      setCompared(true);
                      toast.success("Marked as compared.");
                    }}
                  >
                    They read back the same
                  </Button>
                )}
              </div>
            )}
            {!identityIsTheQuestion && fingerprint && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-gryt-muted">Fingerprint</span>
                <Fingerprint value={fingerprint} />
              </div>
            )}
            {!identityIsTheQuestion && caution}
          </div>
        </Collapsible.Panel>
      </Collapsible.Root>
    </div>
  );
}
