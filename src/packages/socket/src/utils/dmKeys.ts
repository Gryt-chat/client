import {
  dmKeyBindingFor,
  identitySourceUsedFor,
} from "@/common";

/**
 * Publishing this device's DM key (GRYT-727).
 *
 * The one part of this that needs a socket. Deciding what to do about everybody
 * else's keys is `member-keys` in `@gryt/crypto`, where a check can reach it
 * and where the mobile app runs the same one.
 */

/**
 * Send this device's binding for a server it has just joined.
 *
 * Signed with the identity that answered the challenge, which
 * `identitySourceUsedFor` remembers rather than working out again — see the
 * note there. Nothing is sent when it cannot say, because signing with the
 * wrong key produces a binding that verifies and pins and is no longer a
 * statement this server has vouched for.
 *
 * Failures are swallowed. A key that did not reach the server means no
 * encrypted messages with this person, which is where everybody started, and it
 * is not worth failing a join over.
 */
export async function publishDmKey(
  socket: { emit: (event: string, payload: unknown) => unknown },
  host: string,
): Promise<void> {
  const source = identitySourceUsedFor(host);
  if (!source) return;

  try {
    const binding = await dmKeyBindingFor(host, source);
    if (binding) socket.emit("dm:key:publish", { binding });
  } catch {
    // Nothing to retry against, and nothing for anybody to do about it.
  }
}
