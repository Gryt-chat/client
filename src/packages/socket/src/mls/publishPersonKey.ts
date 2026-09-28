import type { AckSocket } from "./transport";

/** `dm:key:publish` has no ack, so the person key can get there first once. */
const NO_DM_KEY_RETRY_MS = 1500;

/** `mls:person:publish` (server#245). True once the server has it. */
export async function publishPersonKey(
  socket: AckSocket,
  accessToken: string,
  binding: string,
  wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  const ask = () =>
    new Promise<{ ok?: boolean; error?: string }>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), 10_000);
      socket.emit("mls:person:publish", { accessToken, binding }, (reply) => {
        clearTimeout(timer);
        resolve((reply as { ok?: boolean; error?: string }) ?? {});
      });
    });
  let reply = await ask();
  if (reply.error === "no_dm_key") {
    await wait(NO_DM_KEY_RETRY_MS);
    reply = await ask();
  }
  if (!reply.ok) console.warn("[MLS] The person key wasn't published:", reply.error);
  return reply.ok === true;
}
