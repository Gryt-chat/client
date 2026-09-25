import { Button, IconButton, Tooltip } from "@gryt/ui";

import { getOwnServerUserId } from "@/common";

import { PiClockFill, PiUserPlusFill } from "../../../../lib/icons";
import { confirmServerFriend, type FriendAction, friendAction, useAllFriends, useFriendState } from "../hooks/friendsStore";

/**
 * The one step you can take next with this person (GRYT-1471). Nothing on a server
 * without friends. `compact` is an icon, for a header that has to fit 300px.
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
  if (!host || !serverUserId || !state || state === "friend" || serverUserId === getOwnServerUserId(host)) return null;

  const send = (action: FriendAction) => () => friendAction(host, action, serverUserId);
  const person = all.find((h) => h.host === host)?.friends.find((p) => p.serverUserId === serverUserId);
  const step =
    state === "none" ? { label: "Add friend", onClick: send("request") }
      : state === "outgoing" ? { label: "Cancel friend request", onClick: send("cancel") }
        : state === "incoming" ? { label: "Accept friend request", onClick: send("accept") }
          : person ? { label: "Confirm friend", onClick: () => confirmServerFriend(host, person) } : null;
  if (!step) return null;

  if (compact) {
    return (
      <Tooltip title={step.label}>
        <IconButton
          aria-label={step.label}
          data-gryt="friend-button"
          data-state={state}
          size="xsmall"
          tone={state === "incoming" ? "primary" : "ghost"}
          onClick={step.onClick}
        >
          {state === "outgoing" ? <PiClockFill size={16} /> : <PiUserPlusFill size={16} />}
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Button
      size="small"
      data-gryt="friend-button"
      data-state={state}
      tone={state === "incoming" ? "primary" : "ghost"}
      onClick={step.onClick}
    >
      {step.label}
    </Button>
  );
}
