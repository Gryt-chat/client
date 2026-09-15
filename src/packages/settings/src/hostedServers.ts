import { normalizeHost } from "@gryt/core";

/* Type-only, so scripts/check-manage-server.mjs can import this module: a value
   import would send Node looking for an extensionless file. */
import type { EmbeddedServerState } from "../../../lib/electron";

/** The settings destination holding the controls for servers this app hosts. */
const MY_SERVERS = "my-servers";

/**
 * The server this app hosts behind a rail entry, matched on its loopback address
 * like the rail's starting ring. Always null in a browser, where the list is empty.
 */
export function hostedServerAt(
  host: string,
  hosted: EmbeddedServerState[],
): EmbeddedServerState | null {
  if (!host) return null;
  return (
    hosted.find(
      (server) => !!server.serverUrl && normalizeHost(server.serverUrl) === host,
    ) ?? null
  );
}

/** The settings tab for My servers, brought to one server's card. */
export function manageServerTab(id: string): string {
  return `${MY_SERVERS}/${id}`;
}

/** Which server a settings tab asks My servers to bring into view, if any. */
export function serverToManage(tab: string): string | null {
  const [destination, id] = tab.split("/");
  return destination === MY_SERVERS && id ? id : null;
}
