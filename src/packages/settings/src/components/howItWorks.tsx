import type { ReactNode } from "react";

/** Explanations stay one click away, so a settings page shows its controls first. */
export function HowItWorks({ children, label = "How this works" }: { children: ReactNode; label?: string }) {
  return (
    <details className="flex flex-col gap-1">
      <summary className="text-xs text-gryt-muted" style={{ cursor: "pointer", width: "fit-content" }}>
        {label}
      </summary>
      <div className="flex flex-col gap-1" style={{ marginTop: 4 }}>
        {children}
      </div>
    </details>
  );
}
