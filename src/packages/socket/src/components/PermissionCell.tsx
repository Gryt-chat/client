import type { ButtonHTMLAttributes } from "react";

import { PiCheckCircleFill, PiMinusCircleFill, PiProhibitFill } from "../../../../lib/icons";

/** `inherit` and `off` both mean "not set here"; `inherited` says what the role already has. */
export type PermissionCellState = "allow" | "deny" | "inherit" | "off";

const LOOK: Record<PermissionCellState, string> = {
  allow:
    "bg-gryt-accent-a4 border-gryt-accent/45 text-gryt-accent-light hover:not-disabled:bg-gryt-accent-a5",
  deny: "bg-gryt-danger-3 border-gryt-danger/45 text-gryt-danger hover:not-disabled:bg-gryt-danger-4 hover:not-disabled:border-gryt-danger",
  inherit:
    "border-dashed border-gryt-border text-gryt-muted hover:not-disabled:bg-gryt-surface-hover hover:not-disabled:border-gryt-accent-light",
  off: "bg-gryt-surface-raised border-gryt-border hover:not-disabled:bg-gryt-surface-hover hover:not-disabled:border-gryt-accent-light",
};

export function PermissionCell({
  state,
  inherited = false,
  className,
  ...props
}: { state: PermissionCellState; inherited?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      data-state={state}
      className={`inline-flex h-6 w-10 shrink-0 items-center justify-center rounded-full border transition-[scale,background-color,border-color] duration-(--gryt-dur-spring) ease-spring motion-safe:hover:not-disabled:scale-[1.08] motion-safe:active:not-disabled:scale-[0.92] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gryt-accent-light disabled:cursor-not-allowed disabled:opacity-50 ${LOOK[state]} ${className ?? ""}`}
      {...props}
    >
      {state === "allow" && <PiCheckCircleFill size={16} aria-hidden />}
      {state === "deny" && <PiProhibitFill size={16} aria-hidden />}
      {state === "inherit" && (
        <span className={inherited ? "opacity-55" : "opacity-55 text-gryt-neutral-9"}>
          {inherited ? <PiCheckCircleFill size={16} aria-hidden /> : <PiMinusCircleFill size={16} aria-hidden />}
        </span>
      )}
    </button>
  );
}
