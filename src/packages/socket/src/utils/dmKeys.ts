import { dmKeyBindingFor } from "@/common";

/**
 * Publishing this device's DM key. The one part of this that needs a socket;
 * deciding about everybody else's is `member-keys` in `@gryt/crypto`.
 */

/**
 * Send this device's binding for a server it is a member of. **Do not gate this
 * on `identitySourceUsedFor`** — it is empty after a reload (GRYT-758).
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
