import { Button, Dialog, IconButton } from "@gryt/ui";
import { useState } from "react";

import { planBanner,type PlanDates } from "@/lib/planMode";

import { CLOUD_CONSOLE_URL } from "../../../../lib/cloud";
import { PiArrowSquareOutBold, PiCreditCardFill, PiProhibitFill, PiShieldWarningFill, PiWarningFill, PiX } from "../../../../lib/icons";
import { useCloudUsage } from "../../../../lib/useCloudUsage";

export const CLOUD_BILLING_URL = `${CLOUD_CONSOLE_URL}/billing`;

type Info = PlanDates & { plan_mode?: string; is_owner?: boolean } | undefined;

/** 6.2 and 6.5: why a Gryt Cloud server is limited, and for the owner the way out. */
export function PlanModeBanner({ host, serverInfo, serverName }: { host: string; serverInfo: Info; serverName: string }) {
  const [why, setWhy] = useState(false);
  const owner = serverInfo?.is_owner === true;
  const b = planBanner(serverInfo?.plan_mode, owner, serverInfo ?? {});
  const usage = useCloudUsage(host, owner && !!b);
  if (!b) return null;
  if (!owner)
    return (
      <div role="status" aria-label="Server plan" className="flex flex-wrap items-center gap-x-3 px-5 py-2.5" style={{ flexShrink: 0, borderRadius: "var(--gryt-radius-lg)", background: "var(--gryt-danger-3)", border: "1px solid var(--gryt-danger-6)" }}>
        <span className="text-sm font-semibold" style={{ color: "var(--gryt-danger-11)" }}>
          {b.title}
        </span>
        <span className="text-[13px] text-gryt-muted">{b.text}</span>
      </div>
    );
  return (
    <>
      <div
        role="status"
        aria-label="Server plan"
        className="flex items-center gap-3.5 px-5 py-3"
        style={{ flexShrink: 0, borderRadius: "var(--gryt-radius-lg)", background: "var(--gryt-danger-3)", border: "1px solid var(--gryt-danger-6)" }}
      >
        <span className="flex shrink-0 items-center justify-center" style={{ width: 36, height: 36, borderRadius: "var(--gryt-radius-md)", background: "var(--gryt-danger-4)", color: "var(--gryt-danger-11)" }}>
          <PiWarningFill size={18} />
        </span>
        <button type="button" onClick={() => owner && setWhy(true)} className="flex min-w-0 flex-1 flex-col border-0 bg-transparent p-0 text-left text-gryt-text" style={{ cursor: owner ? "pointer" : "default" }}>
          <span className="text-sm font-semibold">{b.title}</span>
          <span className={owner ? "text-[13px] underline underline-offset-2" : "text-[13px] text-gryt-muted"}>{b.text}</span>
        </button>
        {owner && (
          <Button onClick={() => window.open(CLOUD_BILLING_URL, "_blank", "noopener,noreferrer")}>
            Try again <PiArrowSquareOutBold size={12} />
          </Button>
        )}
      </div>
      {why && <WhyDialog serverName={serverName} d={serverInfo ?? {}} amount={usage?.amount} failedOn={usage?.failedOn} onClose={() => setWhy(false)} />}
    </>
  );
}

const day = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** 6.3: what happened, what happens next, and the usual reasons a card is refused. */
function WhyDialog({ serverName, d, amount, failedOn, onClose }: { serverName: string; d: PlanDates; amount?: number; failedOn?: number | null; onClose: () => void }) {
  const steps = [
    d.plan_read_only_at && { when: `Until ${day(d.plan_read_only_at)}`, what: "Works as normal", c: "var(--gryt-success-11)" },
    d.plan_read_only_at && { when: day(d.plan_read_only_at), what: "Read-only", c: "var(--gryt-warning-11)" },
    d.plan_paused_at && { when: day(d.plan_paused_at), what: "Paused, deleted after 30 days", c: "var(--gryt-danger-11)" },
  ].filter(Boolean) as { when: string; what: string; c: string }[];
  const causes = [
    { icon: <PiCreditCardFill size={18} />, text: "The card has expired" },
    { icon: <PiShieldWarningFill size={18} />, text: "Your bank blocked an online payment" },
    { icon: <PiProhibitFill size={18} />, text: "Not enough money on the card" },
  ];
  const tile = (bg: string, fg: string) => ({ width: 36, height: 36, borderRadius: "var(--gryt-radius-md)", background: bg, color: fg, flexShrink: 0 });
  const label = "text-[11px] font-semibold uppercase tracking-[.06em] text-gryt-muted";
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[540px] max-w-[calc(100vw-2rem)] gap-[18px] p-6">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center" style={tile("var(--gryt-danger-3)", "var(--gryt-danger-11)")}>
              <PiWarningFill size={18} />
            </span>
            <Dialog.Title className="m-0 flex-1 text-base font-bold">Your card was declined</Dialog.Title>
            <Dialog.Close render={<IconButton aria-label="Close" />}>
              <PiX size={16} />
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-0.5 rounded-(--gryt-radius-lg) border border-gryt-border px-4 py-3">
            <span className="text-[13px] text-gryt-muted">What happened</span>
            <span className="text-sm font-semibold">
              {amount && failedOn
                ? `€${amount} for ${serverName} didn’t go through on ${new Date(failedOn).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                : `The payment for ${serverName} didn’t go through.`}
            </span>
          </div>
          {steps.length > 0 && (
            <>
              <span className={label}>What happens next</span>
              <div className="grid grid-cols-3 gap-1.5">
                {steps.map((s) => (
                  <span key={s.what} className="flex flex-col gap-1.5 text-xs text-gryt-muted">
                    <span style={{ height: 4, borderRadius: 999, background: s.c }} />
                    <strong className="text-[13px] text-gryt-text">{s.when}</strong>
                    {s.what}
                  </span>
                ))}
              </div>
            </>
          )}
          <span className={label}>Common causes</span>
          <div className="flex flex-col overflow-hidden rounded-(--gryt-radius-lg) border border-gryt-border">
            {causes.map((c, i) => (
              <span key={c.text} className="flex min-h-[60px] items-center gap-3.5 px-4 py-3 text-sm font-semibold" style={i ? { borderTop: "1px solid var(--gryt-neutral-4)" } : undefined}>
                <span className="flex items-center justify-center" style={tile("var(--gryt-neutral-4)", "var(--gryt-text)")}>
                  {c.icon}
                </span>
                {c.text}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Button size="large" tone="ghost" onClick={onClose}>
              Close
            </Button>
            <Button size="large" onClick={() => window.open(CLOUD_BILLING_URL, "_blank", "noopener,noreferrer")}>
              Try again <PiArrowSquareOutBold size={12} />
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
