import { generatedServerIconUrl } from "../utils/generatedAvatar";

/**
 * The generated icon for a server, shaped to fill an Avatar. Passed as Radix's
 * `fallback`, so it only appears when the request actually came back empty.
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
