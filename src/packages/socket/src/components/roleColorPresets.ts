/**
 * The colours a role can be given without opening a picker.
 *
 * Ten hues spaced evenly round the wheel at one lightness and one chroma —
 * `oklch(0.66 0.15 h)` — which is what makes them look like a set. Stored as
 * hex because that is what `role_definitions.color` holds, and because a role
 * colour is seen by everybody on the server: it cannot follow the viewer's own
 * accent, or two people would disagree about what Moderator looks like.
 *
 * Every one clears WCAG AA on the member rail in both themes once
 * `readableRoleColor` has pulled it into its band — 4.89:1 at worst dark,
 * 5.11:1 at worst light. The band and this list were fitted to each other.
 */
export const ROLE_COLOR_PRESETS = [
  { name: "Ember", value: "#df6862" },
  { name: "Amber", value: "#d67523" },
  { name: "Moss", value: "#af8f00" },
  { name: "Fern", value: "#4ea954" },
  { name: "Teal", value: "#00aea6" },
  { name: "Sky", value: "#00a1db" },
  { name: "Iris", value: "#648eed" },
  { name: "Violet", value: "#a17adf" },
  { name: "Plum", value: "#c46dbd" },
  { name: "Rose", value: "#d76797" },
] as const;

/**
 * A colour for a role that does not have one yet.
 *
 * The first preset nobody is using, so the second role on a server does not
 * arrive the same colour as the first. Once all ten are spoken for it wraps
 * rather than giving up.
 *
 * Case-insensitive, because a colour typed into the picker comes back lowercase
 * and one pasted by hand might not.
 */
export function nextUnusedPreset(taken: (string | null | undefined)[]): string {
  const used = new Set(
    taken.filter((c): c is string => !!c).map((c) => c.toLowerCase()),
  );
  const free = ROLE_COLOR_PRESETS.find((p) => !used.has(p.value.toLowerCase()));
  return (free ?? ROLE_COLOR_PRESETS[used.size % ROLE_COLOR_PRESETS.length]).value;
}
