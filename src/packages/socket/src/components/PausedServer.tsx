import { Button } from "@gryt/ui";

import { pausedText,type PlanDates } from "@/lib/planMode";

import { CLOUD_CONSOLE_URL } from "../../../../lib/cloud";
import { PiArrowSquareOutBold, PiPauseFill } from "../../../../lib/icons";
import { CLOUD_BILLING_URL } from "./PlanModeBanner";

/** 6.6 (members) and 6.7 (owner): a paused Gryt Cloud server, in place of its channels. */
export function PausedServer({ serverName, isOwner, dates, onLeave }: { serverName: string; isOwner: boolean; dates: PlanDates; onLeave: () => void }) {
  return (
    <div className="flex grow items-center justify-center p-6">
      <div className="flex w-[420px] max-w-full flex-col items-center gap-3.5 text-center">
        <span className="flex items-center justify-center" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--gryt-danger-3)", color: "var(--gryt-danger-11)" }}>
          <PiPauseFill size={26} />
        </span>
        <span className="text-2xl font-bold">{serverName} is paused</span>
        <span className="text-sm text-gryt-muted">{pausedText(isOwner, dates)}</span>
        <div className="flex flex-wrap justify-center gap-2.5 pt-1.5">
          {isOwner ? (
            <>
              <Button tone="neutral" onClick={() => window.open(`${CLOUD_CONSOLE_URL}/servers`, "_blank", "noopener,noreferrer")}>
                Download
              </Button>
              <Button onClick={() => window.open(CLOUD_BILLING_URL, "_blank", "noopener,noreferrer")}>
                Renew <PiArrowSquareOutBold size={12} />
              </Button>
            </>
          ) : (
            <Button tone="neutral" onClick={onLeave}>
              Leave server
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
