import { Button } from "@gryt/ui";

import { useReportForm } from "../lib/reports/useReportForm";
import { ReportDialog } from "./reportDialog";

/** What ErrorBoundary shows. The report form still works here: its store and the providers it reads sit above App. */
export function CrashScreen({ message }: { message: string }) {
  const { open } = useReportForm();

  return (
    <div className="flex items-center justify-center" style={{ width: "100vw", height: "100vh", background: "var(--gryt-neutral-1)" }}>
      <div style={{ textAlign: "center", maxWidth: 420, padding: 32 }}>
        <p className="text-xl font-bold mb-3">
          Something went wrong
        </p>
        <p className="text-sm text-gryt-muted mb-4" style={{ marginTop: 8 }}>
          {message}
        </p>
        <div className="flex flex-col gap-2" style={{ marginTop: 16 }}>
          <Button size="small" tone="primary" onClick={() => open("bug", `Gryt crashed: ${message}\n\nWhat I was doing: `)}>
            Report a bug
          </Button>
          <Button size="small" tone="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
      <ReportDialog />
    </div>
  );
}
