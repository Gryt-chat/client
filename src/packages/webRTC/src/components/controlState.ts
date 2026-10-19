import type { CallControlState } from "./CallControlButton";

/** Blocked by a server admin wins over the person's own off. */
export function controlState(blocked: boolean, off: boolean): CallControlState {
  if (blocked) return "blocked";
  return off ? "off" : "idle";
}
