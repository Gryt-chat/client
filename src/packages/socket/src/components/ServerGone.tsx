import { Button } from "@gryt/ui";

import { PiXCircleFill } from "../../../../lib/icons";
import { useServerManagement } from "../hooks/useServerManagement";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** 7.3: in place of "isn't answering" once the address says the server was deleted. */
export function ServerGone({ host, serverName, deletedOn }: { host: string; serverName: string; deletedOn: string }) {
  const { setShowRemoveServer, setShowAddServer } = useServerManagement();
  return (
    <div className="flex grow items-center justify-center p-6" data-gryt="server-gone">
      <div className="flex w-[26rem] max-w-full flex-col items-center gap-3.5 text-center">
        <span className="flex items-center justify-center" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--gryt-neutral-3)", color: "var(--gryt-neutral-11)" }}>
          <PiXCircleFill size={26} />
        </span>
        <span className="text-xl font-bold">{serverName} is gone</span>
        <span className="text-sm text-gryt-muted">Deleted on {day(deletedOn)}.</span>
        <div className="flex flex-wrap justify-center gap-2.5 pt-1.5">
          <Button tone="neutral" onClick={() => setShowRemoveServer({ host, mode: "remove" })}>
            Remove from list
          </Button>
          <Button onClick={() => setShowAddServer(true)}>Start a new server</Button>
        </div>
      </div>
    </div>
  );
}
