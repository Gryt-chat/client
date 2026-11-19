import { Button, Meter } from "@gryt/ui";

import { CLOUD_CONSOLE_URL } from "../../../../lib/cloud";
import type { CloudUsage } from "../../../../lib/useCloudUsage";
import { formatFileSize } from "../utils/formatFileSize";

const tone = (pct: number) => {
  if (pct >= 90) return "danger" as const;
  return pct >= 75 ? ("warning" as const) : ("primary" as const);
};

function Label({ children }: { children: string }) {
  return <div className="text-[11px] font-semibold tracking-[0.08em] text-gryt-muted uppercase">{children}</div>;
}

/** The same overview as the server's page in the Cloud console, for the owner. */
export function CloudUsageTab({ usage }: { usage: CloudUsage }) {
  const { storage, transfer } = usage;
  const pct = storage.used == null ? 0 : Math.min(100, (storage.used / storage.limit) * 100);
  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="flex flex-col gap-2">
        <Label>Plan</Label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-baseline gap-2">
            <span className="text-lg font-bold">{usage.plan.name}</span>
            <span className="text-sm text-gryt-muted">{usage.cycle === "yearly" ? "Billed yearly" : "Billed monthly"}</span>
          </span>
          <Button size="small" onClick={() => window.open(`${CLOUD_CONSOLE_URL}${usage.manage}`, "_blank", "noopener,noreferrer")}>
            Manage in Gryt Cloud
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label>Storage</Label>
        <div className="flex items-baseline justify-between text-sm">
          <span>{storage.used == null ? "Not counted yet" : `${formatFileSize(storage.used)} used`}</span>
          <span className="font-mono text-xs text-gryt-muted">{formatFileSize(storage.limit)}</span>
        </div>
        <Meter value={pct} aria-label="Storage used" tone={tone(pct)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Transfer this month</Label>
        <span className="text-sm">{transfer.sent == null ? "Not counted yet" : formatFileSize(transfer.sent)}</span>
        <span className="text-xs text-gryt-muted">What the server sent this month. It starts again at zero on the 1st.</span>
      </div>
    </div>
  );
}
