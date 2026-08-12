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
export function GeneratedServerIcon({ seed }: { seed: string }) {
  return (
    <img
      src={generatedServerIconUrl(seed)}
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
