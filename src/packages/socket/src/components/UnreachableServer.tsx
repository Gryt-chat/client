import { Button, Surface } from "@gryt/ui";
import { useState } from "react";

import { PiArrowsClockwiseFill, PiPlugsFill, PiPulseBold } from "../../../../lib/icons";
import { ServerDoctor } from "./ServerDoctor";

/**
 * A server that isn't answering (board 9, GRYT-1751): its name with the reason
 * under it, and the two things worth doing. Replaces the banner and the card.
 */
export function UnreachableServer({
  host,
  serverName,
  sfuHosts,
  stunHosts,
  onTryNow,
}: {
  host: string;
  serverName: string;
  sfuHosts: string[];
  stunHosts: string[];
  onTryNow: () => void;
}) {
  const [doctorOpen, setDoctorOpen] = useState(false);

  return (
    <div className="flex w-full h-full min-w-0 gap-4" data-gryt="server-unreachable">
      <div className="flex flex-col gap-3" style={{ width: 240, flexShrink: 0 }}>
        <Surface style={{ width: "100%" }}>
          <span className="flex flex-col min-w-0">
            <span>{serverName}</span>
            <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--gryt-warning-11)" }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gryt-warning-9)" }} />
              Can&rsquo;t reach it
            </span>
          </span>
        </Surface>
        <p className="text-sm text-gryt-muted" style={{ margin: "0 12px", lineHeight: 1.45 }}>
          The channels show up once it answers.
        </p>
      </div>

      <div className="flex flex-1 min-w-0 items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-center" style={{ maxWidth: 420, paddingBottom: 40 }}>
          <span
            aria-hidden="true"
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "var(--gryt-neutral-3)",
              color: "var(--gryt-neutral-11)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PiPlugsFill size={30} />
          </span>
          <span className="text-lg font-bold" style={{ marginTop: 6 }}>
            {serverName} isn&rsquo;t answering
          </span>
          <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
            It might be down, or this network can&rsquo;t see it.
          </span>
          <div className="flex gap-2.5" style={{ marginTop: 8 }}>
            <Button size="small" onClick={onTryNow}>
              <PiArrowsClockwiseFill size={16} />
              Try now
            </Button>
            <Button size="small" tone="neutral" onClick={() => setDoctorOpen(true)}>
              <PiPulseBold size={16} />
              Check the connection
            </Button>
          </div>
          {serverName !== host && <span className="text-xs text-gryt-muted" style={{ marginTop: 8 }}>{host}</span>}
        </div>
      </div>

      <ServerDoctor
        host={host}
        serverName={serverName}
        socketConnected={false}
        sfuHosts={sfuHosts}
        stunHosts={stunHosts}
        open={doctorOpen}
        onOpenChange={setDoctorOpen}
      />
    </div>
  );
}
