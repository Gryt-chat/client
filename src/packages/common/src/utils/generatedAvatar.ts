/**
 * A generated avatar for anyone who has not set one, and an icon for any server
 * that has not either.
 *
 * Replaces the letter tile. A first initial is a poor identifier — half a member
 * list is an S — where a generated character is distinguishable at a glance and
 * stays the same every time you see that person.
 *
 * People get an owl, from `@gryt/owl`. That is Gryt's own generator, drawn for
 * Gryt, and it replaced DiceBear's Moods here. Moods was fine and cost nothing,
 * but it is a face generator: every avatar was a different creature, so a member
 * list looked like a sticker sheet rather than like one product. The owl is one
 * drawn character — the body, the wings, the face plate and the beak never vary
 * — and what changes is the colour, the expression, the ear tufts and whatever
 * it happens to be wearing.
 *
 * The generator lived in this repository first, under `src/utils/owl/`, with the
 * drawings and the extractor beside it. It is a package now because the mobile
 * app needs the same owls: two apps drawing one person as two different people
 * is the failure the whole arrangement exists to prevent, and a copied directory
 * is how that starts. Adding an accessory happens in the `ui` repository now.
 *
 * Servers still get DiceBear's Planets. A server is not a person and should not
 * be drawn as one, which is why it was a different style to begin with; nothing
 * about that changed. Planets is CC0, so no deployment inherits an attribution
 * obligation it did not choose — several of the nicer DiceBear styles are CC BY,
 * which would have meant carrying a credit line into every deployment.
 *
 * Both render locally rather than through api.dicebear.com. The seed identifies
 * a person, so calling the API would send that to a third party on every render,
 * and would leave any deployment without internet access showing nothing.
 *
 * The Planets definition comes from @dicebear/styles rather than
 * @dicebear/collection. Collection stopped at 9.4.3 and pins core to ^9 — which
 * is why an earlier attempt at "just take the latest core" ended up with a
 * working library and zero styles.
 */

import { Avatar, Style } from "@dicebear/core";
import planetsDefinition from "@dicebear/styles/planets.json";

// Constructed once. A Style parses and validates its definition, and the docs
// are explicit that it is meant to be reused across avatars rather than rebuilt
// per render.
const planets = new Style(planetsDefinition);

// The owls live next door now, and are re-exported here so that every existing
// import of them keeps working. See owlAvatar.ts for why they moved.
export * from "./owlAvatar";

const cache = new Map<string, string>();

/**
 * The same idea for a server that has not set an icon, in a style that is not
 * a character.
 *
 * Seeded on the server's name. A server is the thing it calls itself, and the
 * icon follows that: rename it and the planet changes with it, which is also
 * what makes the create form able to draw a server's icon before it exists.
 *
 * This used to seed on the host, port included, so that two servers on one
 * machine differed and nothing re-rolled when a name changed. Names carry that
 * weight less strictly — two servers both called "My Server" now draw the same
 * planet — but an address is not what anybody recognises a server by, and the
 * icon changing when you rename is the behaviour people expect.
 *
 * Callers that have no name yet (an address pasted before /info answers, an
 * invite before it is fetched) pass the host, so there is still something to
 * draw; it re-seeds once the name arrives.
 */
export function generatedServerIconUrl(seed: string): string {
  const key = `server:${seed}`;
  const cached = cache.get(key);
  if (cached) return cached;

  // No background palette here. Planets brings its own night sky, and forcing
  // the tile hues onto it would light the sky the same colour as somebody's
  // avatar for no reason.
  const svg = new Avatar(planets, { seed }).toString();

  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(key, url);
  return url;
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
