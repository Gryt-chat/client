import type { Socket } from "socket.io-client";

import {
  applyServerProofDecision,
  createClientNonce,
  evaluateServerProof,
  listBlocked,
  type ServerProofDecision,
} from "@/common";

/**
 * Authenticate a server before we say anything else to it (GRYT-51).
 * **Connection-level rather than part of the join handshake** — a client with a
 * saved token reconnects without ever joining, which is the most common path.
 *
 * The gate holds the socket's outgoing traffic until the server has proved
 * itself, queuing and flushing on success or dropping on refusal, so new code
 * cannot forget to be covered by it.
 */

/** How long to wait for a proof before deciding the server isn't offering one. */
const IDENTITY_TIMEOUT_MS = 5000;

type EmitArgs = [event: string, ...args: unknown[]];

export interface GuardedSocket {
  /** Resolves once the server is verified, or rejects if it is refused. */
  verified: Promise<ServerProofDecision>;
}

export function guardSocket(
  socket: Socket,
  host: string,
  onRefused: (decision: ServerProofDecision & { action: "block" }) => void,
): GuardedSocket {
  let settled = false;
  let queue: EmitArgs[] = [];

  const originalEmit = socket.emit.bind(socket);

  // Hold everything except the identity request itself.
  socket.emit = ((event: string, ...args: unknown[]) => {
    if (settled || event === "server:identify") {
      return originalEmit(event, ...args);
    }
    queue.push([event, ...args]);
    return socket;
  }) as typeof socket.emit;

  const release = () => {
    settled = true;
    socket.emit = originalEmit;
    const pending = queue;
    queue = [];
    for (const [event, ...args] of pending) originalEmit(event, ...args);
  };

  const refuse = (decision: ServerProofDecision & { action: "block" }) => {
    settled = true;
    queue = [];
    // Stop reconnecting. Without this the refusal reads to the rest of the app
    // as an ordinary dropped connection and it retries forever, showing "lost
    // connection" instead of what actually happened.
    try {
      socket.io.opts.reconnection = false;
      socket.disconnect();
    } catch {
      // ignore
    }
    onRefused(decision);
  };

  const verified = new Promise<ServerProofDecision>((resolve, reject) => {
    let done = false;

    const settle = async (proof: string | undefined, vouches?: string[]) => {
      if (done) return;
      done = true;

      const nonce = pendingNonce;
      const decision = await evaluateServerProof({ host, proof, sentNonce: nonce, vouches });
      applyServerProofDecision(host, decision);
      logDecision(host, decision);

      if (decision.action === "block") {
        refuse(decision as ServerProofDecision & { action: "block" });
        reject(new Error(`Server identity refused: ${decision.failure.reason}`));
        return;
      }

      release();
      resolve(decision);
    };

    let pendingNonce = "";

    socket.on("connect", () => {
      done = false;
      pendingNonce = createClientNonce();
      originalEmit("server:identify", { clientNonce: pendingNonce });

      // An older server has no handler for that and will never answer. Treat
      // silence as "offered no proof", which is fine for a server we have never
      // pinned and a refusal for one we have.
      setTimeout(() => { void settle(undefined); }, IDENTITY_TIMEOUT_MS);
    });

    socket.on("server:identity", (res: { proof?: string; vouches?: string[]; error?: string }) => {
      void settle(res?.proof, Array.isArray(res?.vouches) ? res.vouches : undefined);
    });
  });

  // A refusal rejects `verified`; callers that don't care still get onRefused.
  verified.catch(() => { /* handled via onRefused */ });

  return { verified };
}

function logDecision(host: string, decision: ServerProofDecision): void {
  switch (decision.action) {
    case "pin":
      console.log(`[ServerAuth] Pinned ${host} as ${decision.keyId}`);
      break;
    case "trusted":
      if (decision.movedFrom) {
        console.log(`[ServerAuth] ${host} is the server previously seen at ${decision.movedFrom}`);
      }
      break;
    case "rotated":
      console.log(
        `[ServerAuth] ${host} rotated its identity key ` +
          `(${decision.previousKeyId} -> ${decision.keyId}` +
          `${decision.hops.length > 1 ? `, ${decision.hops.length} rotations behind` : ""})`,
      );
      break;
    case "unauthenticated":
      console.warn(`[ServerAuth] ${host} offered no identity proof — not pinning.`);
      break;
    case "block":
      console.error(`[ServerAuth] Refusing ${host}: ${decision.failure.reason}`, decision.failure);
      break;
  }
}

/**
 * A rough gap in words, because the exact figure is not the point.
 *
 * A minute out is a missing time sync; a day out is usually a machine that came
 * up without a battery-backed clock at all. Rounding to something sayable makes
 * that difference obvious and a stray hundred milliseconds invisible.
 */
export function describeGap(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** Where to send somebody who cannot act on the sentence alone. */
export function serverProofHelpUrl(
  decision: ServerProofDecision & { action: "block" },
): string | null {
  return decision.failure.reason === "expired"
    ? "https://docs.gryt.chat/docs/guide/troubleshooting#server-clock-is-wrong"
    : null;
}

/** What to show a user when a server is refused. */
export function serverProofErrorMessage(
  decision: ServerProofDecision & { action: "block" },
): string {
  // Destructured so the switch narrows the union — `decision.failure.reason`
  // discriminates the property, not the object.
  const failure = decision.failure;

  switch (failure.reason) {
    case "key_mismatch":
      return (
        "This address is answering with a different server identity than the one " +
        "you joined before. If you rebuilt this server on purpose, remove it from " +
        "the blocked list in settings."
      );
    case "proof_withdrawn":
      return (
        "This server proved its identity before and no longer does. If you rebuilt " +
        "it on purpose, remove it from the blocked list in settings."
      );
    case "blocked": {
      // Reconnect attempts after the first refusal land here, and a bare "it's
      // blocked" loses the reason at exactly the moment the user is deciding
      // whether to unblock. Recover it from what was recorded.
      const entry = listBlocked().find((b) => b.keyId === failure.keyId);
      if (entry?.reason === "key_mismatch") {
        return (
          "Blocked: this address answered with a different server identity than " +
          "the one you joined before. If you rebuilt this server on purpose, " +
          "remove it from the blocked list in settings."
        );
      }
      if (entry?.reason === "proof_withdrawn") {
        return (
          "Blocked: this server proved its identity before and no longer does. " +
          "If you rebuilt it on purpose, remove it from the blocked list in settings."
        );
      }
      return "This server is on your blocked list.";
    }
    case "nonce_mismatch":
      return "This server's identity proof answered a different request. Try again.";
    case "expired": {
      // "Check the clock on both machines" asked the reader to inspect
      // something they may not control, and made them work out which of the two
      // was wrong. The client already knows: it compared the server's timestamp
      // against its own to decide the proof had expired at all.
      const skew = failure.skewMs;
      if (skew === undefined) {
        return "This server's identity proof had expired, which usually means its clock is wrong.";
      }
      const direction = skew > 0 ? "behind" : "ahead of";
      return (
        `This server's clock is about ${describeGap(Math.abs(skew))} ${direction} ` +
        "yours, so its identity proof looked expired. If it is your server, turn on time sync."
      );
    }
    default:
      return "This server's identity proof could not be checked.";
  }
}
