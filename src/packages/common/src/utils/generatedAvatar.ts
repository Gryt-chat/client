/**
 * A generated avatar for anyone who has not set one, and an icon for any server
 * that has not either. People get an owl; servers get DiceBear's Planets (CC0).
 */

import { Avatar, Style } from "@dicebear/core";
import planetsDefinition from "@dicebear/styles/planets.json";

import { getServerHttpBase } from "./url";

// Constructed once. A Style parses and validates its definition, and the docs are
// explicit that it is meant to be reused rather than rebuilt per render.
const planets = new Style(planetsDefinition);

// The owls live next door now, and are re-exported here so that every existing
// import of them keeps working. See owlAvatar.ts for why they moved.
export * from "./owlAvatar";

const cache = new Map<string, string>();

/**
 * The same idea for a server that has not set an icon. Seeded on the name, not
 * the host — callers with no name yet pass the host and it re-seeds later.
 */
export function generatedServerIconUrl(seed: string): string {
  const key = `server:${seed}`;
  const cached = cache.get(key);
  if (cached) return cached;

  // No background palette here. Planets brings its own night sky, and forcing the
  // tile hues onto it would light the sky the colour of somebody's avatar.
  const svg = new Avatar(planets, { seed }).toString();

  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(key, url);
  return url;
}

/**
 * Where to point a server's icon, given what its details say. Once the server has
 * said it has none, asking anyway lets the browser answer from a stale cache.
 */
export function serverIconSrc(
  host: string,
  name: string,
  serverDetailsList: Record<string, { server_info?: { icon_url?: string | null; name?: string } | undefined } | undefined>,
): string {
  const info = serverDetailsList[host]?.server_info;
  if (info?.icon_url) {
    return `${getServerHttpBase(host)}/icon?v=${encodeURIComponent(info.icon_url)}`;
  }
  // The server's own name first: a rename reaches the rail as soon as details
  // refresh. The locally stored name is what we had before it answered.
  if (info) return generatedServerIconUrl(info.name || name || host);
  return `${getServerHttpBase(host)}/icon`;
}

/** A server's own icon if it has one, otherwise one generated from its name. */
export function resolveServerIconSrc(
  iconUrl: string | null | undefined,
  seed: string | null | undefined,
): string | undefined {
  if (iconUrl) return iconUrl;
  if (!seed) return undefined;
  return generatedServerIconUrl(seed);
}
