import { dmKeyBindingFor } from "@/common";

/**
 * Publishing this device's DM key (GRYT-727).
 *
 * The one part of this that needs a socket. Deciding what to do about everybody
 * else's keys is `member-keys` in `@gryt/crypto`, where a check can reach it
 * and where the mobile app runs the same one.
 */

/**
 * Send this device's binding for a server it is a member of.
 *
 * Signed with the key derived from the seed and the server's scope, which is
 * the same key on every device that holds the seed — see `dmKeyBindingFor`.
 *
 * ## It used to ask which identity joined, and that was two bugs
 *
 * `identitySourceUsedFor(host)` decides nothing now, and asking it was worse
 * than redundant. That map is in memory and is filled by answering a challenge,
 * so after a reload it is empty — and a client that already holds a token
 * restores its session instead of answering anything. GRYT-758 moved the
 * publish onto `server:details` so a returning member would reach it, and then
 * this returned early for exactly that member. The event was fixed and the
 * guard behind it was not, so the bug it was meant to close stayed open.
 *
 * The other bug is what the source was used *for*: signing. An account key is
 * generated per device, so two devices published two bindings for one DM key
 * and every peer watched the thumbprint flip. GRYT-759.
 *
 * ## Failures are swallowed
 *
 * A key that did not reach the server means no encrypted messages with this
 * person, which is where everybody started, and it is not worth failing a
 * connection over.
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
