import { isLapsedPlanMode, planModeBannerText } from "@/lib/planMode";

import { PiInfoFill } from "../../../../lib/icons";

/** Says why a Gryt Cloud server refuses writes. It goes away once the plan is renewed. */
export function PlanModeBanner({ serverInfo }: { serverInfo: { plan_mode?: string; is_owner?: boolean } | undefined }) {
  const mode = serverInfo?.plan_mode;
  if (!isLapsedPlanMode(mode)) return null;
  return (
    <div
      role="status"
      aria-label="Server plan"
      className="flex items-center gap-3 px-3 py-2"
      style={{
        flexShrink: 0,
        borderRadius: "var(--gryt-radius-lg)",
        background: "color-mix(in oklab, var(--gryt-warning-9) 7%, transparent)",
        border: "1px solid color-mix(in oklab, var(--gryt-warning-9) 13%, transparent)",
      }}
    >
      <PiInfoFill size={16} style={{ flexShrink: 0, color: "var(--gryt-warning-11)" }} />
      <span className="text-sm" style={{ flex: 1, minWidth: 0 }}>
        {planModeBannerText(mode, serverInfo?.is_owner === true)}
      </span>
    </div>
  );
}
