import { IconButton, type IconButtonProps } from "@gryt/ui";
import { forwardRef, type ReactNode } from "react";

import { PiCaretUpFill, PiLockSimpleFill } from "../../../../lib/icons";

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

/** The call bar's button size: one camera wide, three split buttons, share and leave still fit. */
export const BAR_BUTTON_STYLE = { width: 44, height: 44 } as const;
/** A bar button on its own gets the split buttons' fill, so the row reads as one set. */
export const BAR_SOLO_CLASS = "bg-gryt-neutral-4";

const SPLIT_CLASS: Record<CallControlState, string> = {
  idle: "bg-gryt-neutral-4",
  off: "bg-gryt-danger-3",
  live: "bg-gryt-success-4",
  blocked: "bg-gryt-neutral-4",
};

// Live, the arrow stays inside the green; otherwise it takes the accent so it reads as a menu.
const ARROW_CLASS = { live: "text-gryt-success-11 hover:bg-gryt-success-5", rest: "text-gryt-accent-11 hover:bg-gryt-neutral-6" };
const ARROW_OPEN_CLASS = { live: "bg-gryt-success-5", rest: "bg-gryt-accent-4" };

/** A control with a small arrow on its left for its options, the way Meet does it. */
export function SplitControl({
  state,
  arrowLabel,
  onArrow,
  arrowOpen = false,
  children,
}: {
  state: CallControlState;
  arrowLabel: string;
  onArrow: () => void;
  arrowOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex items-center rounded-full ${SPLIT_CLASS[state]}`}>
      <button
        type="button"
        aria-label={arrowLabel}
        aria-expanded={arrowOpen}
        onClick={onArrow}
        className={`flex h-11 w-[30px] cursor-pointer items-center justify-center rounded-l-full border-0 p-0 ${ARROW_CLASS[state === "live" ? "live" : "rest"]} ${arrowOpen ? ARROW_OPEN_CLASS[state === "live" ? "live" : "rest"] : "bg-transparent"}`}
      >
        <PiCaretUpFill size={11} />
      </button>
      {children}
    </div>
  );
}
