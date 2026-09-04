import { dmKeyBindingFor } from "@/common";

/**
 * Publishing this device's DM key (GRYT-727).
 *
 * The one part of this that needs a socket. Deciding what to do about everybody
 * else's keys is `member-keys` in `@gryt/crypto`, where a check can reach it
 * and where the mobile app runs the same one.
 */

/**
 * Send this device's binding for a server it is a member of, signed with the
 * key derived from the seed and the server's scope — the same key on every
 * device holding the seed. See `dmKeyBindingFor`.
 *
 * **Do not gate this on `identitySourceUsedFor`.** That map is filled by
 * answering a challenge, so it is empty after a reload and for any client
 * restoring a session — which is exactly the returning member GRYT-758 moved
 * this onto `server:details` to reach. Signing with an account key is the other
 * half: those are per device, so two devices published two bindings for one DM
 * key and every peer watched the thumbprint flip (GRYT-759).
 *
 * Failures are swallowed. No key means no encrypted messages, which is where
 * everybody started, and it is not worth failing a connection over.
 */
export async function publishDmKey(
  socket: { emit: (event: string, payload: unknown) => unknown },
  host: string,
): Promise<void> {
  try {
    const binding = await dmKeyBindingFor(host);
    if (binding) socket.emit("dm:key:publish", { binding });
  } catch {
    // No seed yet, or storage that will not answer. Nothing to retry against.
  }
}
