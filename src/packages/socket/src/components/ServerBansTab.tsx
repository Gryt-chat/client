import { Button, Chip, Surface } from "@gryt/ui";
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
 * banning did, and nothing had ever emitted either — so a ban could only be
 * lifted by editing the database by hand.
 *
 * Names come from the server and can be null when the user's row is gone, in
 * which case the identifier is shown rather than an empty row.
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gryt-muted">
          {loaded ? `${bans.length} ${bans.length === 1 ? "ban" : "bans"}` : "Loading…"}
        </span>
        <Button tone="neutral" size="xsmall" onClick={refresh}>Refresh</Button>
      </div>

      {loaded && bans.length === 0 && (
        <span className="text-sm text-gryt-muted">Nobody is banned from this server.</span>
      )}

      {bans.map((ban) => (
        <Surface key={ban.gryt_user_id}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {ban.nickname || ban.gryt_user_id}
                </span>
                {ban.expires_at ? (
                  <Chip tone="warning">
                    until {fmt(ban.expires_at)}
                  </Chip>
                ) : (
                  <Chip tone="danger" label="permanent" />
                )}
              </div>
              {ban.reason && <span className="text-xs">{ban.reason}</span>}
              <span className="text-xs text-gryt-muted">
                {fmt(ban.created_at)}
                {ban.banned_by_nickname ? ` · by ${ban.banned_by_nickname}` : ""}
              </span>
            </div>
            <Button tone="neutral" size="xsmall"
              onClick={() => onUnban(ban.gryt_user_id)}
              style={{ flexShrink: 0 }}
            >
              Unban
            </Button>
          </div>
        </Surface>
      ))}
    </div>
  );
}
