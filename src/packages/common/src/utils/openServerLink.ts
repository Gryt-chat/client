/* The link to share for a server anyone can join. Kept apart from the hook that copies it,
   so scripts/check-invite-link.mjs can import it without a bundler. */

import type { EmbeddedServerState } from "../../../../lib/electron";
import { inviteLink } from "./invite.ts";
import { type AdvertisedServer, isLoopbackHost, pickPublicHost } from "./shareableHost.ts";

export const NO_PUBLIC_ADDRESS = "This server has no public address, so there's no link to copy.";
export const ADD_PUBLIC_ADDRESS = "Add a public IP or hostname under Settings → My servers.";

/** The server this app runs behind a loopback address, matched on the port. */
export function hostedAdvertisement(
  host: string,
  servers: EmbeddedServerState[],
): AdvertisedServer | null {
  if (!isLoopbackHost(host)) return null;
  const port = Number(host.split(":").pop());
  if (!Number.isFinite(port)) return null;
  return servers.find((s) => s.config?.serverPort === port)?.config ?? null;
}

export type OpenServerLink =
  | { kind: "ok"; url: string }
  /** `hosted` says whether this app runs it, which is when adding an address is up to you. */
  | { kind: "no-public-address"; hosted: boolean };

/** The host-only link, named by an address that works from outside. Never a LAN or loopback one. */
export function openServerLink(host: string, hosted: AdvertisedServer | null): OpenServerLink {
  const target = pickPublicHost(host, hosted);
  return target.kind === "ok"
    ? { kind: "ok", url: inviteLink(target.host) }
    : { kind: "no-public-address", hosted: !!hosted };
}
