import type { UserStatus } from "../types/clients";
import { statusConfig } from "./memberStatus";

/**
 * The member list's own colour for a status, as a small dot. `undefined`
 * draws nothing — that is "no data", not "offline" (GRYT-1467).
 */
export function PresenceDot({
  status,
  size = 8,
}: {
  status: UserStatus | undefined;
  size?: number;
}) {
  if (!status) return null;
  return (
    <span
      aria-hidden
      style={{
        display: "block",
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: "50%",
        background: statusConfig[status].color,
      }}
    />
  );
}
