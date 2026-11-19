/* eslint-disable @typescript-eslint/ban-types -- checks a mode a server sent */
/** A Gryt Cloud server after a failed payment. The words are ours, not the server's. */
export type PlanMode = "active" | "read_only" | "paused";

export function isLapsedPlanMode(v: unknown): v is Exclude<PlanMode, "active"> {
  return v === "read_only" || v === "paused";
}

const DAY = 86_400_000;
const inDays = (at: number, now: number) => Math.max(1, Math.ceil((at - now) / DAY));
const date = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export type PlanDates = { plan_read_only_at?: number; plan_paused_at?: number; plan_deleted_at?: number };

/** The banner's two lines, per the journey: 6.2 for the owner, 6.5 for members. Null when there's nothing to say. */
export function planBanner(mode: string | undefined, isOwner: boolean, d: PlanDates, now = Date.now()): { title: string; text: string } | null {
  if (mode === "read_only")
    return isOwner
      ? { title: "Server is read-only", text: d.plan_paused_at ? `Server pauses in ${inDays(d.plan_paused_at, now)} days` : "Renew to turn posting back on" }
      : { title: "Read-only", text: "You can read and listen. Posting is off." };
  if (mode === "active" && isOwner && d.plan_read_only_at && d.plan_read_only_at > now)
    return { title: "Card declined", text: `Server becomes read-only in ${inDays(d.plan_read_only_at, now)} days` };
  return null;
}

/** 6.6 and 6.7: what a paused server says instead of its channels. */
export function pausedText(isOwner: boolean, d: PlanDates): string {
  if (!isOwner) return "The owner needs to renew it.";
  return d.plan_deleted_at ? `Deleted on ${date(d.plan_deleted_at)} unless you renew.` : "Renew it to open it again.";
}

export function planModeRefusalText(mode: Exclude<PlanMode, "active">): string {
  return mode === "paused"
    ? "This server is paused, so that didn't go through."
    : "This server is read-only right now, so that didn't go through.";
}

/** What the composer says on a read-only server, or undefined when posting works. */
export function planLineFor(info: { plan_mode?: string; is_owner?: boolean } | undefined, serverName: string): string | undefined {
  if (info?.plan_mode !== "read_only") return undefined;
  return info.is_owner ? "Read-only" : `${serverName} is read-only for now`;
}
