import { Flex, Text } from "@radix-ui/themes";

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
export function Wordmark({
  size = "5",
  weight = "bold",
}: {
  size?: "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
  weight?: "regular" | "medium" | "bold";
}) {
  const isBeta = useIsBetaBuild();

  return (
    <Flex align="center" gap="2">
      <Text size={size} weight={weight}>
        Gryt
      </Text>
      {isBeta && <BetaTag />}
    </Flex>
  );
}
