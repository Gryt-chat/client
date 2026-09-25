import { Avatar, Button, Dialog } from "@gryt/ui";
import type { ReactNode } from "react";

import { getUploadsFileUrl, resolveAvatarSrc, serverIconSrc } from "@/common";

import {
  confirmServerFriend,
  friendAction,
  type HostFriends,
  setFriendsOpen,
  useAllFriends,
  useFriendsOpen,
} from "../hooks/friendsStore";
import { useServerManagement } from "../hooks/useServerManagement";
import { useSockets } from "../hooks/useSockets";
import type { ServerFriendPerson } from "../utils/friendList";
import { EmojiText } from "./EmojiText";
import { ServerMark } from "./ServerChip";

/**
 * Your friends, requests and sent requests, one server at a time (GRYT-1471).
 * Friends never cross servers, so neither does a row here.
 */
export function FriendsDialog() {
  const open = useFriendsOpen();
  const all = useAllFriends();
  const { servers } = useServerManagement();
  const { memberLists, serverDetailsList } = useSockets();

  const shown = all.filter((h) => h.friends.length + h.incoming.length + h.outgoing.length > 0);

  function person(host: string, p: ServerFriendPerson, actions: ReactNode, note?: string) {
    const member = memberLists[host]?.find((m) => m.serverUserId === p.serverUserId);
    const name = member?.nickname || p.nickname || "Somebody";
    return (
      <div key={`${host}/${p.serverUserId}`} data-gryt="friend-row" data-server-user-id={p.serverUserId} className="flex items-center gap-2 px-2 py-1">
        <Avatar
          size="small"
          fallback={name[0]}
          src={resolveAvatarSrc(
            member?.avatarFileId ? getUploadsFileUrl(host, member.avatarFileId, { thumb: true }) : undefined,
            name,
            member?.avatarWorn,
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">
            <EmojiText text={name} />
          </span>
          {note && <span className="text-xs text-gryt-muted">{note}</span>}
        </span>
        <span className="flex shrink-0 gap-1">{actions}</span>
      </div>
    );
  }

  function section(title: string, rows: ReactNode[]) {
    if (rows.length === 0) return null;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="px-2 pt-1 text-xs font-semibold text-gryt-muted">{title}</span>
        {rows}
      </div>
    );
  }

  function server(h: HostFriends) {
    const name = servers[h.host]?.name || h.host;
    const act = (action: Parameters<typeof friendAction>[1], id: string) => () => friendAction(h.host, action, id);
    return (
      <section key={h.host} data-gryt="friends-server" data-host={h.host} className="flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-sm" style={{ fontWeight: 600 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, overflow: "hidden", display: "block" }}>
            <ServerMark src={serverIconSrc(h.host, servers[h.host]?.name || "", serverDetailsList)} seed={name} />
          </span>
          {name}
        </h3>
        {section(
          "Requests",
          h.incoming.map((p) =>
            person(h.host, p, (
              <>
                <Button size="xsmall" onClick={act("accept", p.serverUserId)}>Accept</Button>
                <Button size="xsmall" tone="ghost" onClick={act("decline", p.serverUserId)}>Decline</Button>
              </>
            )),
          ),
        )}
        {section(
          "Friends",
          h.friends.map((p) =>
            person(
              h.host,
              p,
              <>
                {!p.confirmed && (
                  <Button size="xsmall" onClick={() => confirmServerFriend(h.host, p)}>Confirm</Button>
                )}
                <Button size="xsmall" tone="ghost" onClick={act("remove", p.serverUserId)}>Remove</Button>
              </>,
              p.confirmed ? undefined : "Not added on this device. Confirm it if you know them.",
            ),
          ),
        )}
        {section(
          "Sent",
          h.outgoing.map((p) =>
            person(h.host, p, <Button size="xsmall" tone="ghost" onClick={act("cancel", p.serverUserId)}>Cancel</Button>),
          ),
        )}
      </section>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => setFriendsOpen(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup data-gryt="friends-dialog">
          <Dialog.Title>Friends</Dialog.Title>
          <Dialog.Description>
            You make friends on one server at a time. Your list stays on this device.
          </Dialog.Description>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="text-sm text-gryt-muted">
                No friends yet. Right-click somebody on a server, or open your conversation with them, and pick Add friend.
              </p>
            ) : (
              shown.map(server)
            )}
          </div>
          <Dialog.Footer>
            <Button tone="ghost" onClick={() => setFriendsOpen(false)}>Close</Button>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
