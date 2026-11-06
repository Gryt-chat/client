import { Button, Surface } from "@gryt/ui";
import { useState } from "react";

import { PiArrowsClockwiseFill, PiGlobeSimpleFill, PiPlugsFill, PiPulseBold } from "../../../../lib/icons";
import { useLocale } from "../../../../lib/localeContext";
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
  publicHost,
  onUsePublic,
}: {
  host: string;
  serverName: string;
  sfuHosts: string[];
  stunHosts: string[];
  onTryNow: () => void;
  /** The address it answers on from anywhere, when this one is its LAN address (GRYT-2007). */
  publicHost?: string;
  onUsePublic?: () => void;
}) {
  const [doctorOpen, setDoctorOpen] = useState(false);
  const { t } = useLocale();

  return (
    <div className="flex w-full h-full min-w-0 gap-4" data-gryt="server-unreachable">
      <div className="flex flex-col gap-3" style={{ width: 200, flexShrink: 0 }}>
        <Surface style={{ width: "100%" }}>
          <span className="flex flex-col min-w-0">
            <span>{serverName}</span>
            <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--gryt-warning-11)" }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gryt-warning-9)" }} />
              {t("Can’t reach it")}
            </span>
          </span>
        </Surface>
        <p className="text-sm text-gryt-muted" style={{ margin: "0 12px", lineHeight: 1.45 }}>
          {t("The channels show up once it answers.")}
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
            {serverName} {t("isn’t answering")}
          </span>
          <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
            {t("It might be down, or this network can’t see it.")}
          </span>
          <div className="flex gap-2.5" style={{ marginTop: 8 }}>
            <Button size="small" onClick={onTryNow}>
              <PiArrowsClockwiseFill size={16} />
              {t("Try now")}
            </Button>
            <Button size="small" tone="neutral" onClick={() => setDoctorOpen(true)}>
              <PiPulseBold size={16} />
              {t("Check the connection")}
            </Button>
          </div>
          {publicHost && publicHost !== host && onUsePublic && (
            <Button size="small" tone="ghost" onClick={onUsePublic}>
              <PiGlobeSimpleFill size={16} />
              {t("Connect through")} {publicHost}
            </Button>
          )}
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
