
import { BETA_ACCENT, useIsBetaBuild } from "../utils/betaBuild";

/** The tag itself, for the rare place that has its own wordmark markup. */
export function BetaTag() {
  return (
    <span
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "#12111a",
        background: BETA_ACCENT,
        padding: "2px 5px",
        borderRadius: 4,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      beta
    </span>
  );
}

/**
 * "Gryt", plus the beta tag when this is a beta build.
 *
 * Everywhere the name is written should use this, so a beta build is marked in
 * all of them at once rather than in whichever ones someone remembered.
 */
const TEXT_SIZE = {
  "1": "text-xs",
  "2": "text-sm",
  "3": "text-base",
  "4": "text-lg",
  "5": "text-xl",
  "6": "text-2xl",
  "7": "text-3xl",
  "8": "text-4xl",
  "9": "text-6xl",
} as const;

const FONT_WEIGHT = {
  regular: "font-normal",
  medium: "font-medium",
  bold: "font-bold",
} as const;

export function Wordmark({
  size = "5",
  weight = "bold",
}: {
  size?: "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
  weight?: "regular" | "medium" | "bold";
}) {
  const isBeta = useIsBetaBuild();

  return (
    <div className="flex items-center gap-2">
      {/* The size and weight props kept Radix's scales; these are the same
          steps in Tailwind's. */}
      <span className={`${TEXT_SIZE[size]} ${FONT_WEIGHT[weight]}`}>Gryt</span>
      {isBeta && <BetaTag />}
    </div>
  );
}
