import { Button, Dialog, IconButton } from "@gryt/ui";
import { useState } from "react";

import { planBanner,type PlanDates } from "@/lib/planMode";

import { PiArrowSquareOutBold, PiClockFill, PiProhibitFill, PiShieldWarningFill, PiWarningFill, PiX } from "../../../../lib/icons";

export const CLOUD_BILLING_URL = "https://cloud.gryt.chat/billing";

type Info = PlanDates & { plan_mode?: string; is_owner?: boolean } | undefined;

/** 6.2 and 6.5: why a Gryt Cloud server is limited, and for the owner the way out. */
export function PlanModeBanner({ serverInfo, serverName }: { serverInfo: Info; serverName: string }) {
  const [why, setWhy] = useState(false);
  const owner = serverInfo?.is_owner === true;
  const b = planBanner(serverInfo?.plan_mode, owner, serverInfo ?? {});
  if (!b) return null;
  return (
    <>
      <div
        role="status"
        aria-label="Server plan"
        className="flex items-center gap-3 px-3 py-2"
        style={{ flexShrink: 0, borderRadius: "var(--gryt-radius-lg)", background: "var(--gryt-danger-3)", border: "1px solid var(--gryt-danger-6)" }}
      >
        <PiWarningFill size={18} style={{ flexShrink: 0, color: "var(--gryt-danger-11)" }} />
        <button type="button" onClick={() => owner && setWhy(true)} className="flex min-w-0 flex-1 flex-col border-0 bg-transparent p-0 text-left text-gryt-text" style={{ cursor: owner ? "pointer" : "default" }}>
          <span className="text-sm font-bold">{b.title}</span>
          <span className="text-xs text-gryt-muted">{b.text}</span>
        </button>
        {owner && (
          <Button size="small" onClick={() => window.open(CLOUD_BILLING_URL, "_blank", "noopener,noreferrer")}>
            Try again <PiArrowSquareOutBold size={12} />
          </Button>
        )}
      </div>
      {why && <WhyDialog serverName={serverName} d={serverInfo ?? {}} onClose={() => setWhy(false)} />}
    </>
  );
}

const day = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** 6.3: what happened, what happens next, and the usual reasons a card is refused. */
function WhyDialog({ serverName, d, onClose }: { serverName: string; d: PlanDates; onClose: () => void }) {
  const steps = [
    d.plan_read_only_at && { when: `Until ${day(d.plan_read_only_at)}`, what: "Works as normal", c: "var(--gryt-success-11)" },
    d.plan_read_only_at && { when: day(d.plan_read_only_at), what: "Read-only", c: "var(--gryt-warning-11)" },
    d.plan_paused_at && { when: day(d.plan_paused_at), what: "Paused, deleted after 30 days", c: "var(--gryt-danger-11)" },
  ].filter(Boolean) as { when: string; what: string; c: string }[];
  const causes = [
    { icon: <PiClockFill size={18} />, text: "The card has expired" },
    { icon: <PiShieldWarningFill size={18} />, text: "Your bank blocked an online payment" },
    { icon: <PiProhibitFill size={18} />, text: "Not enough money on the card" },
  ];
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[30rem] max-w-[calc(100vw-2rem)]">
          <div className="flex items-center gap-3">
            <PiWarningFill size={20} style={{ color: "var(--gryt-danger-11)" }} />
            <Dialog.Title className="m-0 flex-1 text-lg font-bold">Your card was declined</Dialog.Title>
            <Dialog.Close render={<IconButton aria-label="Close" />}>
              <PiX size={16} />
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase text-gryt-muted">What happened</span>
            <span className="text-sm">The payment for {serverName} didn’t go through.</span>
          </div>
          {steps.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase text-gryt-muted">What happens next</span>
              <div className="grid grid-cols-3 gap-2">
                {steps.map((s) => (
                  <span key={s.what} className="flex flex-col gap-0.5 pt-2 text-xs text-gryt-muted" style={{ borderTop: `3px solid ${s.c}` }}>
                    <strong className="text-sm text-gryt-text">{s.when}</strong>
                    {s.what}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase text-gryt-muted">Common causes</span>
            {causes.map((c) => (
              <span key={c.text} className="flex items-center gap-3 text-sm">
                <span className="text-gryt-muted">{c.icon}</span>
                {c.text}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button tone="ghost" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => window.open(CLOUD_BILLING_URL, "_blank", "noopener,noreferrer")}>
              Try again <PiArrowSquareOutBold size={12} />
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
