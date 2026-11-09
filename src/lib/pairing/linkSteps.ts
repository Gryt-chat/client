import type { ApproverState, HistoryProgress, NewDeviceState } from "@gryt/core";
import { useEffect } from "react";

import { sendingHistoryText } from "./approverWords.ts";

export interface LinkStep {
  label: string;
  detail?: string;
  state: "done" | "busy" | "todo";
}

/** Marks each step done, busy or todo from where `at` is in the list. */
export function stepsAt(labels: { label: string; detail?: string }[], at: number): LinkStep[] {
  return labels.map((s, i) => {
    if (i < at) return { ...s, state: "done" };
    return { ...s, state: i === at ? "busy" : "todo" };
  });
}

/** Keeps the screen on while `active`, since a sleeping computer drops the link. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    const take = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then(
        (l) => (released ? void l.release() : (lock = l)),
        () => undefined,
      );
    };
    take();
    // The browser drops the lock when the window is hidden, so take it again on return.
    document.addEventListener("visibilitychange", take);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", take);
      void lock?.release();
    };
  }, [active]);
}

export type ApproverInFlight = Extract<ApproverState, { phase: "signing_in" | "browser" | "waiting_ready" | "adding" | "sending" }>;
const APPROVER_ORDER: ApproverInFlight["phase"][] = ["signing_in", "waiting_ready", "adding", "sending"];

/** The approving side, from Approve to Done. The sign-in row only exists for an account. */
export function approverSteps(state: ApproverInFlight, history: HistoryProgress | null, signedIn: boolean): LinkStep[] {
  const name = state.device.name || "the new device";
  const labels = [
    { label: "Checked it\u2019s yours", detail: "The pictures matched" },
    ...(signedIn ? [{ label: `Signing in ${name}` }] : []),
    { label: `Waiting for ${name} to join your servers` },
    { label: "Adding it to your chats", detail: state.phase === "adding" && state.total ? `${state.done} of ${state.total}` : undefined },
    ...(history
      ? [{ label: "Copying older messages", detail: state.phase === "sending" && history.total !== 0 ? sendingHistoryText(history) : undefined }]
      : []),
  ];
  const at = APPROVER_ORDER.indexOf(state.phase === "browser" ? "signing_in" : state.phase) + (signedIn ? 1 : 0);
  return stepsAt(labels, at);
}

export type NewDeviceInFlight = Extract<NewDeviceState, { phase: "signing_in" | "joining" | "linked" }>;

/** The new device's side, from Approve until it's linked. */
export function newDeviceSteps(state: NewDeviceInFlight, signedIn: boolean): LinkStep[] {
  const servers = state.phase === "joining" ? state.servers.length : 0;
  const labels = [
    { label: "Checked it\u2019s yours", detail: `The pictures matched on ${state.from}` },
    ...(signedIn ? [{ label: state.phase === "signing_in" ? `Signing in as ${state.username}` : "Signed in" }] : []),
    { label: servers === 1 ? "Joining your server" : "Joining your servers", detail: servers > 1 ? `${servers} servers` : undefined },
    { label: "Getting added to your chats", detail: "Your other device does this" },
  ];
  if (state.phase === "signing_in") return stepsAt(labels, 1);
  return stepsAt(labels, (state.phase === "joining" ? 1 : 2) + (signedIn ? 1 : 0));
}
