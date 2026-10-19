import { Avatar, Button, PreviewCard } from "@gryt/ui";

import { getUploadsFileUrl, resolveAvatarSrc, serverIconSrc } from "@/common";
import { useSettings } from "@/settings";
import { useServerManagement } from "@/socket";
import { GroupFace } from "@/socket/src/components/GroupFace";
import { ServerMark } from "@/socket/src/components/ServerChip";
import { useDirectory } from "@/socket/src/hooks/dmDirectory";
import { requestConversation, setDmSpaceOpen } from "@/socket/src/hooks/dmSpace";
import { callClock, useCallClock } from "@/socket/src/hooks/useCallClock";
import { conversationTitle } from "@/socket/src/hooks/useDirectMessages";
import { useSockets } from "@/socket/src/hooks/useSockets";

const FACE = 36;

/**
 * The top of the rail's call capsule: whose call this is, as a circle with the
 * call's green ring. Hovering says where it is and offers the way back to it.
 */
export function CallCapsuleFace({ host, channelId, live }: { host: string; channelId: string; live: boolean }) {
  const directory = useDirectory();
  const { servers, switchToServer, viewServerBehindDmSpace } = useServerManagement();
  const { serverDetailsList, clients, memberLists } = useSockets();
  const { setShowVoiceView } = useSettings();
  const seconds = useCallClock(live, `${host}/${channelId}`);

  const entry = directory.find((e) => e.host === host && e.conversation.conversation_id === channelId);
  const serverName = servers[host]?.name || host;
  const channel = serverDetailsList[host]?.channels?.find((c) => c.id === channelId);
  const title = entry ? conversationTitle(entry.conversation) : channel?.name ?? "Voice";
  const where = entry ? `${entry.conversation.kind === "group" ? "Group call" : "Call"} · ${serverName}` : `Voice · ${serverName}`;

  const people = Object.values(clients[host] ?? {}).filter((c) => c.hasJoinedChannel && c.voiceChannelId === channelId);
  const faceOf = (serverUserId: string | undefined, nickname: string) => {
    const m = serverUserId ? memberLists[host]?.find((x) => x.serverUserId === serverUserId) : undefined;
    return resolveAvatarSrc(m?.avatarFileId ? getUploadsFileUrl(host, m.avatarFileId, { thumb: true }) : undefined, nickname, m?.avatarWorn);
  };

  const back = () => {
    if (entry) {
      requestConversation(host, channelId);
      viewServerBehindDmSpace(host);
      setDmSpaceOpen(true);
    } else {
      switchToServer(host);
    }
    setShowVoiceView(true);
  };

  // A DM's person, a group's faces, or the server's icon filling the circle.
  const serverFace = (
    <span style={{ display: "block", width: FACE, height: FACE, borderRadius: "50%", overflow: "hidden" }}>
      <ServerMark src={serverIconSrc(host, servers[host]?.name || "", serverDetailsList)} seed={serverName} />
    </span>
  );
  const personFace = entry && entry.conversation.kind !== "group" ? (
    <Avatar style={{ width: FACE, height: FACE }} fallback={entry.conversation.other.nickname[0]} src={faceOf(entry.conversation.other.server_user_id, entry.conversation.other.nickname)} />
  ) : serverFace;
  const face = entry?.conversation.kind === "group" ? (
    <span style={{ display: "block", width: FACE, height: FACE, borderRadius: "50%", overflow: "hidden" }}>
      <GroupFace host={host} conversation={entry.conversation} size={FACE} />
    </span>
  ) : personFace;

  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        render={
          <button
            type="button"
            aria-label={`Back to ${title}`}
            data-gryt="call-capsule-face"
            onClick={back}
            className="mb-1 cursor-pointer rounded-(--gryt-radius-full) border-0 bg-transparent p-0"
            style={{ boxShadow: "0 0 0 2px var(--gryt-success-3), 0 0 0 4px var(--gryt-call-ring)" }}
          />
        }
      >
        {face}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="right" align="end" sideOffset={14}>
          <PreviewCard.Popup className="flex w-[250px] flex-col gap-2.5 p-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold">{title}</span>
              <span className="text-xs text-gryt-muted">{where}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold tabular-nums" style={{ color: "var(--gryt-success-11)" }}>
                {live ? `In a call · ${callClock(seconds)}` : "Connecting…"}
              </span>
              <span className="ml-auto flex">
                {people.slice(0, 5).map((p) => (
                  <Avatar
                    key={p.serverUserId ?? p.nickname}
                    style={{ width: 24, height: 24, marginLeft: -6, boxShadow: "0 0 0 2px var(--gryt-surface)" }}
                    fallback={p.nickname[0]}
                    src={faceOf(p.serverUserId, p.nickname)}
                  />
                ))}
              </span>
            </div>
            <Button size="small" className="self-start" onClick={back}>Back to the call</Button>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
