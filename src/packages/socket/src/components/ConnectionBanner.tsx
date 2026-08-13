import { Button, Spinner } from "@gryt/ui";
import { PiArrowsClockwiseFill, PiWifiSlashFill } from "react-icons/pi";

interface ConnectionBannerProps {
  connectionStatus: string;
  onReconnect: () => void;
}

export const ConnectionBanner = ({ connectionStatus, onReconnect }: ConnectionBannerProps) => {
  const isReconnecting = connectionStatus === "reconnecting";
  return (
    <div className="flex items-center gap-3 px-3 py-2" style={{
        flexShrink: 0,
        borderRadius: "var(--gryt-radius-lg)",
        background: isReconnecting ? "color-mix(in oklab, var(--gryt-warning-9) 7%, transparent)" : "color-mix(in oklab, var(--gryt-danger-9) 7%, transparent)",
        border: `1px solid ${isReconnecting ? "color-mix(in oklab, var(--gryt-warning-9) 13%, transparent)" : "color-mix(in oklab, var(--gryt-danger-9) 13%, transparent)"}`,
      }}>
      {isReconnecting
        ? <Spinner size={16} />
        : <PiWifiSlashFill size={14} color="var(--gryt-danger-9)" style={{ flexShrink: 0 }} />}
      <span className="text-sm font-medium" style={{ flex: 1 }}>
        {isReconnecting ? "Reconnecting to server..." : "Server is unreachable"}
      </span>
      {connectionStatus === "disconnected" && (
        <Button tone="neutral" size="xsmall" style={{ flexShrink: 0 }} onClick={onReconnect}>
          <PiArrowsClockwiseFill size={12} /> Reconnect
        </Button>
      )}
    </div>
  );
};
