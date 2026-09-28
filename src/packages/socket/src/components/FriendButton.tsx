import { Button, IconButton, Tooltip } from "@gryt/ui";
import { useState } from "react";

import { getOwnServerUserId } from "@/common";

import { PiCheckBold, PiClockFill, PiUserPlusFill, PiXBold } from "../../../../lib/icons";
import { confirmServerFriend, friendAction, useAllFriends, useFriendState } from "../hooks/friendsStore";
import { friendButtonSteps, type FriendStep, type FriendStepIcon } from "../utils/friendButtonSteps";
import { ConfirmDialog } from "./ConfirmDialog";

const ICONS: Record<FriendStepIcon, typeof PiUserPlusFill> = {
  add: PiUserPlusFill,
  clock: PiClockFill,
  check: PiCheckBold,
  close: PiXBold,
  confirm: PiUserPlusFill,
};

/**
 * The one step you can take next with this person (GRYT-1471, GRYT-1573). `compact`
 * drops the label -- its one spot, the DM header, is part of a 300px-wide window.
 */
export function FriendButton({
  host,
  serverUserId,
  compact = false,
}: {
  host: string | undefined;
  serverUserId: string | undefined;
  compact?: boolean;
}) {
  const state = useFriendState(host, serverUserId);
  const all = useAllFriends();
  const [pending, setPending] = useState<FriendStep | null>(null);

  if (!host || !serverUserId || !state || state === "friend" || serverUserId === getOwnServerUserId(host)) return null;

  const hostFriends = all.find((h) => h.host === host);
  const person =
    hostFriends?.friends.find((p) => p.serverUserId === serverUserId) ??
    hostFriends?.incoming.find((p) => p.serverUserId === serverUserId) ??
    hostFriends?.outgoing.find((p) => p.serverUserId === serverUserId);
  const name = person?.nickname || "them";

  const steps = friendButtonSteps(state, name);
  if (steps.length === 0) return null;

  const run = (step: FriendStep) => {
    if (step.action === "confirm") {
      if (person) confirmServerFriend(host, person);
    } else {
      friendAction(host, step.action, serverUserId);
    }
  };

  const activate = (step: FriendStep) => (step.confirm ? setPending(step) : run(step));

  return (
    <div className="flex flex-col gap-1">
      <div className={compact ? "flex items-center gap-1" : "flex items-center gap-1.5"}>
        {steps.map((step) => {
          const Icon = ICONS[step.icon];
          return compact ? (
            <Tooltip key={step.action} title={step.hint}>
              <IconButton
                aria-label={step.hint}
                data-gryt="friend-button"
                data-state={step.action}
                size="xsmall"
                tone={step.tone}
                onClick={() => activate(step)}
              >
                <Icon size={16} />
              </IconButton>
            </Tooltip>
          ) : (
            <Button
              key={step.action}
              size="small"
              data-gryt="friend-button"
              data-state={step.action}
              tone={step.tone}
              startIcon={<Icon size={14} />}
              onClick={() => activate(step)}
            >
              {step.label}
            </Button>
          );
        })}
      </div>

      {/* The only step with a confirm today is outgoing's cancel, so this doubles
          as its caption -- room the compact header, sharing a row with Call, hasn't got. */}
      {!compact && steps.length === 1 && steps[0].confirm && (
        <span className="text-xs text-gryt-muted">{steps[0].hint}</span>
      )}

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => { if (!open) setPending(null); }}
        title={pending?.confirm?.title ?? ""}
        description={pending?.confirm?.description}
        confirmLabel={pending?.confirm?.confirmLabel ?? "Confirm"}
        cancelLabel={pending?.confirm?.cancelLabel ?? "Cancel"}
        confirmTone="primary"
        onConfirm={() => { if (pending) run(pending); }}
      />
    </div>
  );
}
