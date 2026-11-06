import { Button, Dialog } from "@gryt/ui";

import { useLocale } from "../../../../lib/localeContext";
import { friendAction, useFriendState } from "../hooks/friendsStore";
import { useServerManagement } from "../hooks/useServerManagement";
import { useSockets } from "../hooks/useSockets";
import { setFriendRequestOpen, useOpenFriendRequest } from "./friendRequestToast";
import { MemberIdentityCard } from "./MemberIdentityCard";

/** Their whole card, the server it came through, and Accept / Decline right there. */
export function FriendRequestDialog() {
  const { t } = useLocale();
  const current = useOpenFriendRequest();
  const { memberLists } = useSockets();
  const { servers } = useServerManagement();
  const state = useFriendState(current?.host, current?.serverUserId);
  const member = current ? memberLists[current.host]?.find((m) => m.serverUserId === current.serverUserId) : undefined;
  const serverName = current ? servers[current.host]?.name || current.host : "";

  const answer = (action: "accept" | "decline") => {
    if (!current) return;
    friendAction(current.host, action, current.serverUserId);
    setFriendRequestOpen(null);
  };

  return (
    <Dialog.Root open={!!current} onOpenChange={(next) => { if (!next) setFriendRequestOpen(null); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[24rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <Dialog.Title>{member ? `${member.nickname} ${t("chat.wantsToBeFriends")}` : t("chat.friendRequest")}</Dialog.Title>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <span className="text-gryt-muted">{t("chat.on")} {serverName}</span>
            {member ? <MemberIdentityCard member={member} serverHost={current?.host} inline /> : null}
            {state === "incoming" || state === null ? (
              <div className="flex flex-wrap gap-2">
                <Button className="flex-1" onClick={() => answer("accept")}>{t("chat.accept")}</Button>
                <Button className="flex-1" tone="neutral" onClick={() => answer("decline")}>{t("chat.decline")}</Button>
              </div>
            ) : (
              <span className="text-gryt-muted">{t("chat.youVeAlreadyAnsweredThisOne")}</span>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
