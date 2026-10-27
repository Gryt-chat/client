/**
 * What to do with a device the engine reports. A stored choice wins, but only once it has
 * been read: before that, "nothing chosen" and "not read yet" both look like "".
 */

/** `hold` is the case that was missing: the report is kept until the settings arrive. */
export type Adoption = "write" | "hold" | "keep";

export function adoptDevice(
  settingsLoaded: boolean,
  storedId: string | null | undefined,
): Adoption {
  if (!settingsLoaded) return "hold";
  /* Recording a fallback over a choice is what let unplugging a headset replace it, so
     anything already stored is left alone. */
  return storedId ? "keep" : "write";
}
