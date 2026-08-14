import { Button, Spinner } from "@gryt/ui";
import { PiArrowsClockwiseFill, PiClockFill, PiWarningCircleFill, PiWifiSlashFill } from "react-icons/pi";

import { ServerDetailsSkeleton } from "./skeletons";

interface ServerLoadingStatesProps {
  serverFailure?: { error: string; message?: string };
  hasTimedOut: boolean;
  refusalReason?: string;
  refusalHelpUrl?: string;
  connectionStatus?: 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'refused';
  onReconnect?: () => void;
}

const cardStyle: React.CSSProperties = {
  textAlign: "center",
  maxWidth: 380,
  padding: "40px 32px",
  borderRadius: "var(--gryt-radius-xl)",
  background: "var(--gryt-neutral-2)",
  border: "1px solid var(--gryt-neutral-5)",
  boxShadow: "0 1px 4px var(--gryt-neutral-a3)",
};

/**
 * Failures where the server answered and said no.
 *
 * Worth separating from the rest, because "Failed to load server" and a Retry
 * button are wrong for all of them: nothing failed to load, and pressing Retry
 * asks the same question and gets the same answer. What changes the outcome is
 * signing in, or a moderator — never the button.
 */
const REFUSALS = new Set([
  "identity_tier_refused",
  "join_refused",
  "banned",
  "membership_required",
]);

const iconWrapStyle = (bg: string): React.CSSProperties => ({
  width: 56,
  height: 56,
  borderRadius: "var(--gryt-radius-lg)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: bg,
  flexShrink: 0,
});

export const ServerLoadingStates = ({
  serverFailure,
  hasTimedOut,
  connectionStatus,
  refusalReason,
  refusalHelpUrl,
  onReconnect,
}: ServerLoadingStatesProps) => {
  if (serverFailure) {
    const wasRefused = REFUSALS.has(serverFailure.error);
    return (
      <div className="flex w-full h-full items-center justify-center p-4">
        <div style={cardStyle}>
          <div className="flex flex-col items-center gap-4">
            <div style={iconWrapStyle("color-mix(in oklab, var(--gryt-danger-9) 7%, transparent)")}>
              <PiWarningCircleFill size={28} color="var(--gryt-danger-9)" />
            </div>
            <div className="flex flex-col gap-2 items-center">
              <span className="text-lg font-bold">
                {wasRefused ? "You can't join this server" : "Failed to load server"}
              </span>
              <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
                {serverFailure.error === "rate_limited"
                  ? "You're being rate limited. Please wait a moment and try again."
                  : serverFailure.message ||
                    "An error occurred while loading server details."}
              </span>
            </div>
            {!wasRefused && (
              <Button size="small"
                onClick={() => window.location.reload()}
                style={{ marginTop: 4 }}
              >
                <PiArrowsClockwiseFill size={16} />
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (connectionStatus === 'reconnecting') {
    return (
      <div className="flex w-full h-full items-center justify-center p-4">
        <div style={cardStyle}>
          <div className="flex flex-col items-center gap-4">
            <div style={{
              ...iconWrapStyle("color-mix(in oklab, var(--gryt-warning-9) 7%, transparent)"),
              animation: "pulse-reconnect 2s ease-in-out infinite",
            }}>
              <Spinner size={24} />
            </div>
            <div className="flex flex-col gap-2 items-center">
              <span className="text-lg font-bold">
                Reconnecting...
              </span>
              <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
                Lost connection to the server. Attempting to reconnect automatically.
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Refused on identity grounds, not a network fault. Saying "the server may be
  // offline" here would send someone off checking their wifi over what is
  // meant to be a security warning — and there is deliberately no Reconnect
  // button, because retrying is not the answer.
  if (connectionStatus === 'refused') {
    return (
      <div className="flex w-full h-full items-center justify-center p-4">
        <div style={cardStyle}>
          <div className="flex flex-col items-center gap-4">
            <div style={iconWrapStyle("color-mix(in oklab, var(--gryt-danger-9) 7%, transparent)")}>
              <PiWifiSlashFill size={26} color="var(--gryt-danger-9)" />
            </div>
            <div className="flex flex-col gap-2 items-center">
              <span className="text-lg font-bold">
                Server identity not recognised
              </span>
              <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
                {refusalReason ??
                  "This server could not prove it is the one you joined before."}
              </span>
              {refusalHelpUrl && (
                <a
                  href={refusalHelpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline text-gryt-muted hover:text-gryt-text"
                >
                  How to fix this
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (connectionStatus === 'disconnected') {
    return (
      <div className="flex w-full h-full items-center justify-center p-4">
        <div style={cardStyle}>
          <div className="flex flex-col items-center gap-4">
            <div style={iconWrapStyle("color-mix(in oklab, var(--gryt-danger-9) 7%, transparent)")}>
              <PiWifiSlashFill size={26} color="var(--gryt-danger-9)" />
            </div>
            <div className="flex flex-col gap-2 items-center">
              <span className="text-lg font-bold">
                Server unreachable
              </span>
              <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
                Unable to establish a connection. The server may be offline or there could be a network issue.
              </span>
            </div>
            <Button size="small"
              onClick={onReconnect ?? (() => window.location.reload())}
              style={{ marginTop: 4 }}
            >
              <PiArrowsClockwiseFill size={16} />
              Reconnect
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!hasTimedOut) {
    return (
      <div className="flex w-full h-full gap-4">
        <div className="w-[100%] sm:w-[240px]">
          <ServerDetailsSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full h-full items-center justify-center p-4">
      <div style={cardStyle}>
        <div className="flex flex-col items-center gap-4">
          <div style={iconWrapStyle("color-mix(in oklab, var(--gryt-warning-9) 7%, transparent)")}>
            <PiClockFill size={26} color="var(--gryt-warning-9)" />
          </div>
          <div className="flex flex-col gap-2 items-center">
            <span className="text-lg font-bold">
              Taking longer than expected
            </span>
            <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
              The server is taking a while to respond. This could be due to network conditions or the server being under load.
            </span>
          </div>
          <Button size="small"
            onClick={onReconnect ?? (() => window.location.reload())}
            style={{ marginTop: 4 }}
          >
            <PiArrowsClockwiseFill size={16} />
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
};
