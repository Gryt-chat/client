import { generatedServerIconUrl } from "../utils/generatedAvatar";

/**
 * The generated icon for a server, shaped to fill an Avatar.
 *
 * Passed as Radix's `fallback` rather than as `src` on purpose. A client cannot
 * always tell whether a server has an icon — most places just point at
 * `/icon` and let it fail — and deciding up front means every server draws a
 * generated icon for a moment on startup and then swaps to its real one. As a
 * fallback it only ever appears when the request actually came back empty.
 */
export function GeneratedServerIcon({
  host,
  seed,
}: {
  host: string;
  /**
   * What to draw from, when the host is not the right answer.
   *
   * A server being created has no address yet, so seeding on one would give
   * every new server the same planet until it started. Passing the name people
   * are typing makes the icon theirs while they are still choosing it.
   *
   * Existing servers keep seeding on host deliberately: the seed decides which
   * planet you get, and switching it would silently re-roll the icon of every
   * server anybody has already joined.
   */
  seed?: string;
}) {
  return (
    <img
      src={generatedServerIconUrl(seed?.trim() || host)}
      alt=""
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        borderRadius: "inherit",
      }}
    />
  );
}
