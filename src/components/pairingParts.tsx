import type { PairingEmoji } from "@gryt/crypto";
import { Spinner } from "@gryt/ui";
import type { ReactNode } from "react";

import { PiCheckCircleFill } from "../lib/icons";

/* Shared by both sides of linking a device (GRYT-1484), so the two screens being compared
   draw the emoji the same way. */

export function EmojiRow({ emoji }: { emoji: readonly PairingEmoji[] }) {
  return (
    <ul className="m-0 grid list-none grid-cols-4 gap-2 p-0" aria-label="Emoji to compare">
      {emoji.map((e, i) => (
        <li key={i} className="flex flex-col items-center gap-1 rounded-[var(--gryt-radius-md)] bg-gryt-surface-raised py-3">
          <span className="text-4xl leading-none" aria-hidden="true">{e.emoji}</span>
          <span className="text-xs text-gryt-muted">{e.name}</span>
        </li>
      ))}
    </ul>
  );
}

export function Waiting({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-2 text-sm text-gryt-muted" role="status">
      <Spinner />
      {children}
    </p>
  );
}

import type { LinkStep } from "../lib/pairing/linkSteps";

const SPOKEN: Record<LinkStep["state"], string> = { done: ", done", busy: ", in progress", todo: ", next" };

/** From Approve to Done, on both sides, so a slow step never looks like a hang. */
export function LinkSteps({ steps }: { steps: LinkStep[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-gryt-muted">Keep Gryt open on both devices until this is done.</p>
      <ol className="m-0 flex list-none flex-col gap-3 p-0" role="status">
        {steps.map((step) => (
          <li key={step.label} className="flex items-start gap-3">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
              {step.state === "done" && <PiCheckCircleFill size={20} className="text-gryt-success" />}
              {step.state === "busy" && <Spinner />}
              {step.state === "todo" && <span className="size-4 rounded-full border-2 border-gryt-border" />}
            </span>
            <span className="flex flex-col">
              <span className={step.state === "todo" ? "text-sm text-gryt-muted" : "text-sm"}>
                {step.label}
                <span className="sr-only">{SPOKEN[step.state]}</span>
              </span>
              {step.detail && <span className="text-xs text-gryt-muted">{step.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
