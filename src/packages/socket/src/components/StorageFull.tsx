import { Button } from "@gryt/ui";
import { useEffect, useState } from "react";

import { CLOUD_CONSOLE_URL } from "../../../../lib/cloud";
import { PiArchiveFill } from "../../../../lib/icons";

const gb = (b: number) => `${Math.round(b / 1024 ** 3)}`;

/** 4.12: shown above the composer once an upload is refused for space, until the page reloads. */
export function StorageFull({ host, serverName, isOwner }: { host: string; serverName: string; isOwner: boolean }) {
  const [full, setFull] = useState<{ used: number; limit: number } | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ host: string; used: number; limit: number }>).detail;
      if (d.host === host && d.limit) setFull({ used: d.used, limit: d.limit });
    };
    window.addEventListener("gryt:storage-full", on);
    return () => window.removeEventListener("gryt:storage-full", on);
  }, [host]);
  if (!full) return null;
  return (
    <div className="mx-3 mb-2 flex flex-wrap items-center gap-3 rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface px-3 py-2.5">
      <span className="flex shrink-0 items-center justify-center" style={{ width: 36, height: 36, borderRadius: "var(--gryt-radius-md)", background: "var(--gryt-danger-3)", color: "var(--gryt-danger-11)" }}>
        <PiArchiveFill size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-bold">{serverName} is out of space</span>
        <span className="text-xs text-gryt-muted">
          {gb(Math.min(full.used, full.limit))} / {gb(full.limit)} GB
        </span>
      </span>
      {isOwner && (
        <Button size="small" onClick={() => window.open(`${CLOUD_CONSOLE_URL}/servers/${encodeURIComponent(host)}`, "_blank", "noopener,noreferrer")}>
          Upgrade
        </Button>
      )}
      <Button size="small" tone="neutral" onClick={() => window.dispatchEvent(new CustomEvent("server_settings_open", { detail: { host, tab: "storage" } }))}>
        Free up space
      </Button>
    </div>
  );
}
