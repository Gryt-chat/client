import { io } from "socket.io-client";

import { getCertificateSub, getServerWsBase, getValidCertificate, signAssertion } from "@/common";

export type JoinServerOnceRequest = {
  host: string;
  nickname?: string;
  inviteCode?: string;
};

export type JoinServerOnceSuccess = {
  accessToken: string;
  refreshToken?: string;
  nickname: string;
  avatarFileId?: string | null;
  isOwner?: boolean;
  setupRequired?: boolean;
};

export type JoinServerOnceError = {
  error: string;
  message?: string;
  retryAfterMs?: number;
  currentScore?: number;
  maxScore?: number;
  canReapply?: boolean;
};

export type JoinServerOnceResult =
  | { ok: true; joinInfo: JoinServerOnceSuccess }
  | { ok: false; error: JoinServerOnceError };

function describeConnectError(err: unknown, host: string): JoinServerOnceError {
  const raw = err instanceof Error ? err.message : String(err);

  console.error(`[JoinServer] connect_error for ${host}:`, raw);
  console.debug(`[JoinServer] diagnostics:`, {
    host,
    wsUrl: getServerWsBase(host),
    origin: typeof window !== "undefined" ? window.location.origin : "unknown",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    online: typeof navigator !== "undefined" ? navigator.onLine : "unknown",
  });

  if (/websocket/i.test(raw)) {
    return {
      error: "connect_error",
      message: `WebSocket connection failed — retrying with fallback. If this persists, the server may be unreachable. (${raw})`,
    };
  }
  if (/timeout/i.test(raw)) {
    return {
      error: "connect_error",
      message: `Connection timed out. The server may be down or your network is blocking the connection.`,
    };
  }
  if (/cors/i.test(raw)) {
    return {
      error: "connect_error",
      message: `Connection blocked by CORS policy. The server may not allow connections from this client.`,
    };
  }
  if (raw) {
    return { error: "connect_error", message: `Could not connect to the server: ${raw}` };
  }
  return { error: "connect_error", message: "Could not connect to the server." };
}

export async function joinServerOnce(
  req: JoinServerOnceRequest,
  opts?: { timeoutMs?: number }
): Promise<JoinServerOnceResult> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const wsUrl = getServerWsBase(req.host);

  console.log(`[JoinServer] Connecting to ${req.host} (${wsUrl})…`);

  return await new Promise<JoinServerOnceResult>((resolve) => {
    const socket = io(wsUrl, {
      transports: ["websocket"],
      reconnection: false,
      timeout: timeoutMs,
    });

    let settled = false;
    const finish = (res: JoinServerOnceResult) => {
      if (settled) return;
      settled = true;
      if (res.ok) {
        console.log(`[JoinServer] Successfully joined ${req.host}`);
      } else {
        console.warn(`[JoinServer] Failed to join ${req.host}:`, res.error);
      }
      try {
        socket.disconnect();
      } catch {
        // ignore
      }
      resolve(res);
    };

    const timer = setTimeout(() => {
      console.warn(`[JoinServer] Timed out after ${timeoutMs}ms for ${req.host}`);
      finish({
        ok: false,
        error: { error: "timeout", message: "Timed out connecting to the server. Check the address and try again." },
      });
    }, timeoutMs + 250);

    socket.on("connect", () => {
      console.log(`[JoinServer] Connected to ${req.host}, sending join request…`);
      socket.emit("server:join", {
        nickname: req.nickname,
        inviteCode: req.inviteCode,
      });
    });

    socket.on("server:challenge", async (challenge: { nonce: string; serverHost: string }) => {
      console.log(`[JoinServer] Received challenge from ${req.host}, signing assertion…`);
      try {
        const certificate = await getValidCertificate();
        const sub = getCertificateSub() || "";
        const assertion = await signAssertion(sub, challenge.serverHost, challenge.nonce);
        socket.emit("server:verify", { certificate, assertion });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[JoinServer] Failed to answer challenge for ${req.host}:`, msg);
        clearTimeout(timer);
        finish({
          ok: false,
          error: { error: "identity_error", message: `Identity verification failed: ${msg}` },
        });
      }
    });

    socket.on("server:joined", (joinInfo: JoinServerOnceSuccess) => {
      clearTimeout(timer);
      finish({ ok: true, joinInfo });
    });

    socket.on("server:error", (error: JoinServerOnceError) => {
      clearTimeout(timer);
      console.error(`[JoinServer] server:error from ${req.host}:`, error);
      finish({ ok: false, error });
    });

    socket.on("connect_error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: describeConnectError(err, req.host) });
    });
  });
}

