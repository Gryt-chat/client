import { getUserValue, setUserValue } from "./userStorage";

/* What was on screen when Gryt last closed, so the next launch opens the same
   page rather than the top of the rail. GRYT-1146. */
export type LastView =
  | { kind: "server"; host: string }
  | { kind: "dm"; host: string; conversationId: string | null }
  | { kind: "discovery" };

const KEY = "lastView";

function isLastView(v: unknown): v is LastView {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.kind === "discovery") return true;
  if (o.kind === "server") return typeof o.host === "string";
  if (o.kind === "dm") {
    return typeof o.host === "string"
      && (o.conversationId === null || typeof o.conversationId === "string");
  }
  return false;
}

/** Anything unreadable is nothing, so a bad value opens the rail's top server. */
export function readLastView(): LastView | null {
  const v = getUserValue<unknown>(KEY, null);
  return isLastView(v) ? v : null;
}

export function writeLastView(view: LastView): void {
  setUserValue(KEY, view);
}

/** The server underneath, whichever kind of page it was. */
export function lastViewHost(view: LastView | null): string | null {
  return view && view.kind !== "discovery" ? view.host : null;
}
