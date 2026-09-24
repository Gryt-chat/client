import { IconButton, type IconButtonProps } from "@gryt/ui";
import { forwardRef } from "react";

import { PiLockSimpleFill } from "../../../../lib/icons";

/**
 * One state language for the call bar. Neutral is where each control rests, red is you cut
 * off from the call, green is you sending more than your voice, and a lock is an admin's no.
 */
export type CallControlState = "idle" | "off" | "live" | "blocked";

const STATE_CLASS: Record<CallControlState, string> = {
  idle: "",
  off: "bg-gryt-danger-4 text-gryt-danger-11 hover:not-data-disabled:bg-gryt-danger-5 hover:not-data-disabled:text-gryt-danger-11",
  live: "bg-gryt-success-4 text-gryt-success-11 hover:not-data-disabled:bg-gryt-success-5 hover:not-data-disabled:text-gryt-success-11",
  blocked: "text-gryt-danger-11 opacity-60 cursor-not-allowed hover:not-data-disabled:bg-transparent hover:not-data-disabled:text-gryt-danger-11",
};

export interface CallControlButtonProps extends Omit<IconButtonProps, "tone"> {
  state: CallControlState;
}

/** Forwards its ref and props so it can be a Menu.Trigger's render target. */
export const CallControlButton = forwardRef<HTMLButtonElement, CallControlButtonProps>(
  function CallControlButton({ state, className, children, size = "xsmall", ...rest }, ref) {
    return (
      <IconButton
        ref={ref}
        tone="neutral"
        size={size}
        data-call-state={state}
        aria-disabled={state === "blocked" || undefined}
        className={`relative ${STATE_CLASS[state]} ${className ?? ""}`}
        {...rest}
      >
        {children}
        {state === "blocked" && (
          <PiLockSimpleFill size={9} aria-hidden className="absolute right-0.5 bottom-0.5" />
        )}
      </IconButton>
    );
  },
);

/** Hang up is an action rather than a state, so it gets the solid fill nothing else uses. */
export const LEAVE_CLASS = "bg-gryt-danger text-gryt-on-danger hover:not-data-disabled:bg-gryt-danger-10 hover:not-data-disabled:text-gryt-on-danger";
