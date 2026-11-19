import { Button, IconButton, Toggle, ToggleGroup } from "@gryt/ui";
import { type ReactNode, useState } from "react";

import { PiCaretLeftBold } from "../../../../lib/icons";

export type SubView = { value: string; label: string; description?: string; action?: string; content: ReactNode };

/** One settings tab holding what used to be several: a switch along the top, or rows that open one. */
export function SettingsSubViews({ views, mode = "switch", initial }: { views: SubView[]; mode?: "switch" | "rows"; initial?: string }) {
  const [open, setOpen] = useState<string | null>(initial || (mode === "switch" ? views[0]?.value ?? null : null));
  const shown = views.find((v) => v.value === open) ?? (mode === "switch" ? views[0] : undefined);

  if (mode === "rows" && !shown)
    return (
      <div className="overflow-hidden rounded-[var(--gryt-radius-surface)] border border-gryt-border bg-gryt-surface">
        {views.map((v, i) => (
          <div key={v.value} className={`flex items-center gap-3 px-4 py-3 ${i ? "border-t border-gryt-border" : ""}`}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-bold">{v.label}</span>
              {v.description && <span className="text-xs text-gryt-muted">{v.description}</span>}
            </span>
            <Button size="small" tone="neutral" onClick={() => setOpen(v.value)}>
              {v.action ?? "Open"}
            </Button>
          </div>
        ))}
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {mode === "rows" ? (
        <div className="flex items-center gap-2">
          <IconButton aria-label="Back" onClick={() => setOpen(null)}>
            <PiCaretLeftBold size={16} />
          </IconButton>
          <span className="text-sm font-bold">{shown?.label}</span>
        </div>
      ) : (
        views.length > 1 && (
          <ToggleGroup className="max-[439px]:flex-wrap" value={[shown?.value ?? ""]} onValueChange={(next) => next[0] && setOpen(next[0])} multiple={false}>
            {views.map((v) => (
              <Toggle key={v.value} value={v.value} size="small">
                {v.label}
              </Toggle>
            ))}
          </ToggleGroup>
        )
      )}
      {shown?.content}
    </div>
  );
}
