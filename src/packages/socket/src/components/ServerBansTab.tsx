import { Button, Chip, Surface } from "@gryt/ui";
import { Flex, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { useSocketEvent } from "../hooks/useSocketEvent";

type BanItem = {
  gryt_user_id: string;
  banned_by_server_user_id: string;
  reason: string | null;
  created_at: string | Date;
  expires_at: string | Date | null;
  nickname: string | null;
  banned_by_nickname: string | null;
};

function fmt(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : String(v || "");
}

/**
 * The bans list, and the only way to undo one.
 *
 * `server:bans:list` and `server:unban` have both existed on the server since
 * banning did, and nothing has ever emitted either — so a ban could only be
 * lifted by editing the database by hand.
 *
 * Names come from the server, which joins the users table for them. They can
 * still be null when the user's row is gone entirely, and the identifier is
 * shown in that case rather than an empty row.
 */
export function ServerBansTab({
  host,
  socket,
  accessToken,
  onUnban,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
  onUnban: (grytUserId: string) => void;
}) {
  const [bans, setBans] = useState<BanItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = () => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    socket.emit("server:bans:list", { accessToken });
  };

  useSocketEvent<{ bans: BanItem[] }>(socket, "server:bans", (payload) => {
    setBans(Array.isArray(payload?.bans) ? payload.bans : []);
    setLoaded(true);
  });

  // Unbanning is answered by server:unban:success, not by a fresh list, so ask
  // for one rather than removing the row locally and hoping.
  useSocketEvent(socket, "server:unban:success", () => refresh());

  useEffect(() => {
    if (!host || !socket?.connected || !accessToken) return;
    socket.emit("server:bans:list", { accessToken });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected, accessToken]);

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" justify="between">
        <Text size="2" color="gray">
          {loaded ? `${bans.length} ${bans.length === 1 ? "ban" : "bans"}` : "Loading…"}
        </Text>
        <Button tone="neutral" size="xsmall" onClick={refresh}>Refresh</Button>
      </Flex>

      {loaded && bans.length === 0 && (
        <Text size="2" color="gray">Nobody is banned from this server.</Text>
      )}

      {bans.map((ban) => (
        <Surface key={ban.gryt_user_id}>
          <Flex align="center" justify="between" gap="3">
            <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
              <Flex align="center" gap="2">
                <Text size="2" weight="medium" truncate>
                  {ban.nickname || ban.gryt_user_id}
                </Text>
                {ban.expires_at ? (
                  <Chip tone="warning">
                    until {fmt(ban.expires_at)}
                  </Chip>
                ) : (
                  <Chip tone="danger" label="permanent" />
                )}
              </Flex>
              {ban.reason && <Text size="1">{ban.reason}</Text>}
              <Text size="1" color="gray">
                {fmt(ban.created_at)}
                {ban.banned_by_nickname ? ` · by ${ban.banned_by_nickname}` : ""}
              </Text>
            </Flex>
            <Button tone="neutral" size="xsmall"
              onClick={() => onUnban(ban.gryt_user_id)}
              style={{ flexShrink: 0 }}
            >
              Unban
            </Button>
          </Flex>
        </Surface>
      ))}
    </Flex>
  );
}
