import { Button } from "@gryt/ui";

import { PiPauseFill, PiWarningFill, PiXCircleFill } from "../../../../lib/icons";
import { useServerManagement } from "../hooks/useServerManagement";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** 7.3: in place of "isn't answering" once the address says the server was deleted. */
export function ServerGone({ host, serverName, deletedOn, reason }: { host: string; serverName: string; deletedOn: string; reason?: "cancelled" | "payment" }) {
  const { removeServer, setShowAddServer } = useServerManagement();
  return (
    <div className="flex grow items-center justify-center p-6" data-gryt="server-gone">
      <div className="flex w-[420px] max-w-full flex-col items-center gap-3.5 text-center">
        <span className="flex items-center justify-center" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--gryt-neutral-4)", color: "var(--gryt-neutral-11)" }}>
          <PiXCircleFill size={26} />
        </span>
        <span className="text-2xl font-bold">{reason === "payment" ? `${serverName} was closed` : `${serverName} was closed by its owner`}</span>
        <span className="text-sm text-gryt-muted">It was deleted on {day(deletedOn)}, with its messages and files.</span>
        <div className="flex flex-wrap justify-center gap-2.5 pt-1.5">
          {/* Nothing answers there any more, so leaving is just taking it off this device. */}
          <Button tone="neutral" onClick={() => removeServer(host)}>
            Leave server
          </Button>
          <Button onClick={() => setShowAddServer(true)}>Start a new server</Button>
        </div>
      </div>
    </div>
  );
}

/** A Gryt Cloud server that's paused or down: what happened, from the console, without the channels. */
export function ServerAway({ host, kind, title, text, onTryNow }: { host: string; kind: "paused" | "down"; title: string; text: string; onTryNow?: () => void }) {
  const { removeServer } = useServerManagement();
  const tone = kind === "paused" ? { background: "var(--gryt-danger-3)", color: "var(--gryt-danger-11)" } : { background: "var(--gryt-warning-3)", color: "var(--gryt-warning-11)" };
  return (
    <div className="flex grow items-center justify-center p-6" data-gryt={`server-${kind}`}>
      <div className="flex w-[440px] max-w-full flex-col items-center gap-3.5 text-center">
        <span className="flex items-center justify-center" style={{ width: 56, height: 56, borderRadius: 16, ...tone }}>
          {kind === "paused" ? <PiPauseFill size={26} /> : <PiWarningFill size={26} />}
        </span>
        <span className="text-2xl font-bold">{title}</span>
        <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>{text}</span>
        <div className="flex flex-wrap justify-center gap-2.5 pt-1.5">
          {kind === "paused" ? (
            <Button tone="neutral" onClick={() => removeServer(host)}>
              Leave server
            </Button>
          ) : (
            <>
              <Button tone="neutral" onClick={() => window.open("https://status.gryt.chat", "_blank", "noopener,noreferrer")}>
                Status page
              </Button>
              {onTryNow && <Button onClick={onTryNow}>Try again</Button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
