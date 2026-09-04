import { Avatar, Button } from "@gryt/ui";

import { resolveAvatarSrc } from "@/common";

import { PiPhoneFill, PiPhoneXFill } from "../../../../lib/icons";
import type { IncomingCall } from "../hooks/useCalls";

interface IncomingCallCardProps {
  call: IncomingCall;
  /** What the conversation is called, so a group says its name rather than one member's. */
  title: string;
  /** The caller's picture, already resolved to a URL, or nothing. */
  avatarUrl?: string;
  avatarWorn?: string | null;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * Somebody is ringing.
 *
 * A card in the corner rather than a dialog: a modal would take the whole app
 * away from somebody in the middle of typing, and a ringing phone must not make
 * everything else unusable for thirty seconds.
 *
 * It disappears on its own. The server withdraws every ring it starts — answer,
 * decline, cancellation or timeout — so this needs no dismiss of its own, and
 * should not have one: a ring you closed but did not answer would still be
 * ringing at the other end.
 */
export function IncomingCallCard({
  call,
  title,
  avatarUrl,
  avatarWorn,
  onAccept,
  onDecline,
}: IncomingCallCardProps) {
  return (
    <div
      role="alertdialog"
      aria-label={`${call.from.nickname} is calling`}
      className="fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-3 rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface-raised p-4 shadow-lg"
    >
      <div className="flex items-center gap-3">
        <Avatar
          size="medium"
          fallback={call.from.nickname[0]}
          src={resolveAvatarSrc(avatarUrl, call.from.nickname, avatarWorn)}
        />
        <div className="min-w-0">
          <div className="truncate font-medium text-gryt-text">{title}</div>
          {/* Says who, because in a group the title is the group's name and
              "somebody is calling" is not enough to decide whether to pick up. */}
          <div className="truncate text-xs text-gryt-muted">
            {call.from.nickname} is calling
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="small" tone="primary" style={{ flex: 1 }} onClick={onAccept}>
          <span className="flex items-center justify-center gap-2">
            <PiPhoneFill size={14} /> Answer
          </span>
        </Button>
        <Button size="small" tone="ghost" style={{ flex: 1 }} onClick={onDecline}>
          <span className="flex items-center justify-center gap-2">
            <PiPhoneXFill size={14} /> Decline
          </span>
        </Button>
      </div>
    </div>
  );
}
