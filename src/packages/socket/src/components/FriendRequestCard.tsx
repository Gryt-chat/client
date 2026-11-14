import { Avatar, Button } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { getUploadsFileUrl, resolveAvatarSrc, serverIconSrc } from "@/common";

import { friendAction, useAllFriends } from "../hooks/friendsStore";
import { useServerManagement } from "../hooks/useServerManagement";
import { useSockets } from "../hooks/useSockets";
import { setFriendRequestOpen } from "./friendRequestToast";
import { ServerMark } from "./ServerChip";

const SETTLE_MS = 8000;

export function FriendRequestCard({ id, host, serverUserId, name }: { id: string; host: string; serverUserId: string; name: string }) {
  const lists = useAllFriends();
  const { memberLists, serverDetailsList } = useSockets();
  const { servers } = useServerManagement();
  const [asked, setAsked] = useState<"accept" | "failed" | null>(null);
  const [answered, setAnswered] = useState(false);
  const mine = lists.find((h) => h.host === host);
  const stillWaiting = !!mine?.incoming.some((p) => p.serverUserId === serverUserId);
  const member = memberLists[host]?.find((m) => m.serverUserId === serverUserId);
  const serverName = servers[host]?.name || host;
  const shownName = member?.nickname || name;
  const accepted = answered && asked === "accept" && !stillWaiting;

  useEffect(() => {
    if (!accepted) return;
    const timer = setTimeout(() => toast.dismiss(id), 3000);
    return () => clearTimeout(timer);
  }, [accepted, id]);

  useEffect(() => {
    if (!answered || !stillWaiting) return;
    const timer = setTimeout(() => setAsked("failed"), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [answered, stillWaiting]);

  const busy = answered && stillWaiting && asked !== "failed";
  const answer = (action: "accept" | "decline") => {
    if (!mine) return void toast.error(`${serverName} is offline, so you can't ${action} this right now.`, { id: "friend:offline" });
    if (busy) return void toast.error("Still waiting for the server to answer.", { id: "friend:busy" });
    friendAction(host, action, serverUserId);
    if (action === "decline") return toast.dismiss(id);
    setAsked("accept");
    setAnswered(true);
  };

  let label = "Accept";
  if (busy) label = "Accepting";
  else if (asked === "failed") label = "Try again";

  return (
    <span className="flex w-full flex-col gap-3.5">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-3 text-left"
        onClick={() => { toast.dismiss(id); setFriendRequestOpen({ host, serverUserId }); }}
      >
        <Avatar
          fallback={shownName[0]}
          src={resolveAvatarSrc(
            member?.avatarFileId ? getUploadsFileUrl(host, member.avatarFileId, { thumb: true }) : undefined,
            shownName,
            member?.avatarWorn,
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-3 text-sm">
            <b className="truncate font-semibold">{shownName}</b>
            <span className="shrink-0 text-gryt-muted">{accepted ? "is your friend now" : "wants to be friends"}</span>
          </span>
          <span className="flex items-center gap-1.5 self-start text-xs text-gryt-muted">
            <span style={{ width: 14, height: 14, borderRadius: 5, overflow: "hidden", display: "block", flexShrink: 0 }}>
              <ServerMark src={serverIconSrc(host, servers[host]?.name || "", serverDetailsList)} seed={serverName} />
            </span>
            {serverName}
          </span>
        </span>
      </button>
      {asked === "failed" && <span role="alert" className="text-xs text-gryt-danger">Couldn&rsquo;t reach the server. Try again.</span>}
      {!accepted && (
        <span className="flex gap-2">
          <Button className="flex-1" tone="neutral" onClick={() => answer("decline")}>Decline</Button>
          <Button className="flex-1" onClick={() => answer("accept")}>
            {label}
          </Button>
        </span>
      )}
    </span>
  );
}
