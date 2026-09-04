import { Button, Surface } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { useSocketEvent } from "../hooks/useSocketEvent";

type JoinRequestItem = {
  grytUserId: string;
  nickname: string;
  note: string | null;
  createdAt: string | Date;
};

function fmt(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : String(v || "");
}

/**
 * People waiting to be let in, on a server whose join policy is "request".
 *
 * The note is the only part they control, so it is rendered as text and never
 * as markup.
 *
 * Approving does not admit anybody on its own: the server records the decision
 * and they get in the next time they try, which is what they were told would
 * happen when they were turned away.
 */
export function ServerJoinRequestsTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  const [requests, setRequests] = useState<JoinRequestItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);

  const refresh = () => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    socket.emit("server:joinRequests:list", { accessToken });
  };

  useSocketEvent<{ requests: JoinRequestItem[] }>(socket, "server:joinRequests", (payload) => {
    setRequests(Array.isArray(payload?.requests) ? payload.requests : []);
    setLoaded(true);
    setDeciding(null);
  });

  // The decision is answered on its own, not with a fresh list — and two
  // moderators can be looking at the same queue, so ask for the list again
  // rather than dropping the row locally.
  useSocketEvent<{ grytUserId: string; decision: string }>(
    socket,
    "server:joinRequest:decided",
    (payload) => {
      toast.success(payload?.decision === "approved" ? "Let in." : "Turned down.");
      refresh();
    },
  );

  useEffect(() => {
    if (!host || !socket?.connected || !accessToken) return;
    socket.emit("server:joinRequests:list", { accessToken });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected, accessToken]);

  const decide = (grytUserId: string, decision: "approved" | "denied") => {
    if (!socket?.connected || !accessToken) return toast.error("Not connected to the server yet.");
    setDeciding(grytUserId);
    socket.emit("server:joinRequests:decide", { accessToken, grytUserId, decision });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gryt-muted">
          {loaded
            ? `${requests.length} ${requests.length === 1 ? "person waiting" : "people waiting"}`
            : "Loading…"}
        </span>
        <Button tone="neutral" size="xsmall" onClick={refresh}>
          Refresh
        </Button>
      </div>

      <span className="text-xs text-gryt-muted" style={{ lineHeight: 1.4 }}>
        Only fills up while <strong>Who can join</strong> is set to asking first. Approving
        somebody does not pull them in — they get in the next time they try.
      </span>

      {loaded && requests.length === 0 && (
        <span className="text-sm text-gryt-muted">
          Nobody is waiting.
        </span>
      )}

      {requests.map((request) => (
        <Surface key={request.grytUserId}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
              <span className="text-sm font-medium truncate">
                {request.nickname}
              </span>
              {request.note && (
                <span className="text-xs" style={{ overflowWrap: "anywhere" }}>
                  {request.note}
                </span>
              )}
              <span className="text-xs text-gryt-muted">
                {fmt(request.createdAt)}
              </span>
            </div>
            <div className="flex gap-2" style={{ flexShrink: 0 }}>
              <Button tone="neutral" size="xsmall"
                disabled={deciding === request.grytUserId}
                onClick={() => decide(request.grytUserId, "denied")}
              >
                Turn down
              </Button>
              <Button tone="neutral" size="xsmall"
                disabled={deciding === request.grytUserId}
                onClick={() => decide(request.grytUserId, "approved")}
              >
                Let in
              </Button>
            </div>
          </div>
        </Surface>
      ))}
    </div>
  );
}
