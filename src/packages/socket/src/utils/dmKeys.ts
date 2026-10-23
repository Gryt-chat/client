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
  socket: { emit: (event: string, payload: unknown, ack?: (reply: { ok?: boolean; error?: string }) => void) => unknown },
  host: string,
  { replace = false }: { replace?: boolean } = {},
): Promise<boolean> {
  try {
    const binding = await dmKeyBindingFor(host);
    if (!binding) return false;
    // A server from before GRYT-1868 never answers, and took the key anyway.
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(true), 10_000);
      socket.emit("dm:key:publish", { binding, ...(replace ? { replace } : {}) }, (reply) => {
        clearTimeout(timer);
        resolve(reply?.ok !== false);
      });
    });
  } catch {
    // No seed yet, or storage that will not answer. Nothing to retry against.
    return false;
  }
}
