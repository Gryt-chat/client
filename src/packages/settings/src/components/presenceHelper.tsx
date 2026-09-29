import { Button } from "@gryt/ui";

import type { usePresenceHelper } from "../hooks/usePresenceHelper";
import { HowItWorks } from "./howItWorks";
import { helperCopy, helperStateLine } from "./presenceHelperCopy";

/** Off until somebody turns it on here. Nothing else registers it (GRYT-1605). */
export function PresenceHelperSettings({ helper }: { helper: ReturnType<typeof usePresenceHelper> }) {
  if (!helper.offered) return null;
  const line = helperStateLine(helper);

  return (
    <div id="gryt-helper" className="flex flex-col gap-1 rounded-md px-2 py-2" style={{ background: "var(--gryt-neutral-3)" }}>
      <span className="text-sm font-medium">{helperCopy.title}</span>
      <HowItWorks>
        <span className="text-xs text-gryt-muted">{helperCopy.about}</span>
        <span className="text-xs text-gryt-muted">{helperCopy.cost}</span>
      </HowItWorks>
      {line && (
        <span
          className="text-xs"
          role={line.warn ? "status" : undefined}
          style={line.warn ? { color: "var(--gryt-warning-11)" } : undefined}
        >
          {line.text}
        </span>
      )}
      <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
        {helper.enabledAt ? (
          <>
            <Button size="xsmall" tone="neutral" disabled={helper.busy} onClick={() => void helper.set(false)}>
              {helperCopy.turnOff}
            </Button>
            <span className="text-xs text-gryt-muted">{helperCopy.offNote}</span>
          </>
        ) : (
          <Button id="gryt-helper-on" size="xsmall" disabled={helper.busy} onClick={() => void helper.set(true)}>
            {helperCopy.turnOn}
          </Button>
        )}
      </div>
    </div>
  );
}
