/* Hallmark · component: status-indicator · genre: modern-minimal · theme: @gryt/ui
 * states: idle · starting · settling · connecting · reconnecting · offline · voice */

/**
 * What a server is doing, drawn around its icon in the rail. **Two shapes, not
 * two colours**: a sweep means working, a depleting ring means time running out.
 */
export type ServerRingState =
  | "none"
  | "starting"
  | "settling"
  | "connecting"
  | "reconnecting";

/**
 * `pathLength` normalises the stroke's dash units to 0–100, so the dash maths
 * does not have to know a rounded rectangle's perimeter at any size.
 */
const PATH_LENGTH = 100;

/** The sweeping arc's share of the ring. Long enough to read as motion, short
 *  enough that it is obviously not a full ring being drawn. */
const SWEEP_DASH = 22;

export function ServerStatusRing({
  state,
  settleMs,
}: {
  state: ServerRingState;
  /** How long `settling` has before the entry is called offline. */
  settleMs: number;
}) {
  if (state === "none") return null;

  const depleting = state === "settling";

  const stroke =
    state === "starting"
      ? "var(--gryt-accent-9)"
      : state === "reconnecting"
        ? "var(--gryt-warning-9)"
        // neutral-10, not neutral-8: that measured 1.95:1 against the rail,
        // under the 3:1 a non-text indicator needs. This clears it at 3.63:1.
        : "var(--gryt-neutral-10)";

  return (
    <svg
      aria-hidden
      viewBox="0 0 48 48"
      className="gryt-server-ring"
      data-depleting={depleting ? "" : undefined}
      style={{
        position: "absolute",
        // Outside the icon rather than on top of it, so the artwork is never
        // obscured by its own status.
        inset: -3,
        width: "calc(100% + 6px)",
        height: "calc(100% + 6px)",
        pointerEvents: "none",
        overflow: "visible",
        // The depleting ring is timed to the budget it is depleting, so the
        // duration is data rather than decoration.
        ["--gryt-ring-duration" as string]: depleting ? `${settleMs}ms` : undefined,
      }}
    >
      <rect
        x="2"
        y="2"
        width="44"
        height="44"
        rx="13"
        fill="none"
        pathLength={PATH_LENGTH}
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={depleting ? PATH_LENGTH : `${SWEEP_DASH} ${PATH_LENGTH - SWEEP_DASH}`}
      />
    </svg>
  );
}
