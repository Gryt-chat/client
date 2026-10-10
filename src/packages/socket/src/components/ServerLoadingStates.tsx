import { Button, Spinner } from "@gryt/ui";

import { useTranslation } from "@/i18n";

import { PiArrowsClockwiseFill, PiClockFill, PiWarningCircleFill, PiWifiSlashFill } from "../../../../lib/icons";
import { ServerDetailsSkeleton } from "./skeletons";

interface ServerLoadingStatesProps {
  serverFailure?: { error: string; message?: string };
  hasTimedOut: boolean;
  refusalReason?: string;
  refusalHelpUrl?: string;
  connectionStatus?: 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'refused';
  onReconnect?: () => void;
  onSignIn?: () => void;
  /**
   * Let this device back into a server it was signed out of. Separate from
   * `onSignIn`: it is still signed in to Gryt and still a member (GRYT-987).
   */
  onResumeHere?: () => void;
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
 * Failures where the server answered and said no. Retry asks the same question
 * and gets the same answer; signing in or a moderator is what changes it.
 */
const REFUSALS = new Set([
  "identity_tier_refused",
  "join_refused",
  "banned",
  "membership_required",
]);

/**
 * Failures where signing in again is the whole fix. They differ in the heading
 * only: "expired" is the wrong word for a session ended on purpose.
 */
const SIGN_IN_AGAIN: Record<string, string> = {
  session_expired: "connection.expired",
  session_ended: "connection.ended",
};

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
  onSignIn,
  onResumeHere,
}: ServerLoadingStatesProps) => {
  const { t: tr } = useTranslation();
  // The session ending is not a loading failure and Retry is the wrong verb.
  // Signing in is the only thing that changes the answer, so it is the only button.
  const signInHeading = serverFailure ? SIGN_IN_AGAIN[serverFailure.error] : undefined;
  if (signInHeading) {
    return (
      <div className="flex w-full h-full items-center justify-center p-4">
        <div style={cardStyle}>
          <div className="flex flex-col items-center gap-4">
            <div style={iconWrapStyle("color-mix(in oklab, var(--gryt-warning-9) 7%, transparent)")}>
              <PiClockFill size={26} color="var(--gryt-warning-9)" />
            </div>
            <div className="flex flex-col gap-2 items-center">
              <span className="text-lg font-bold">
                {tr(signInHeading)}
              </span>
              <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
                {serverFailure?.message ||
                  tr("ui.signInAgainToReconnectToThisServer")}
              </span>
            </div>
            {/* A token that ran out and a device somebody signed out want
                different buttons. The first needs a Gryt sign-in; the second
                is still signed in and still a member, and needs this machine
                to say it is allowed back. */}
            {serverFailure?.error === "session_ended" && onResumeHere ? (
              <Button size="small" onClick={onResumeHere} style={{ marginTop: 4 }}>
                {tr("ui.useThisServerHereAgain")}
              </Button>
            ) : (
              onSignIn && (
                <Button size="small" onClick={onSignIn} style={{ marginTop: 4 }}>
                  {tr("ui.signIn")}
                </Button>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

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
                {wasRefused ? tr("ui.youCanTJoinThisServer") : tr("ui.failedToLoadServer")}
              </span>
              <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
                {serverFailure.error === "rate_limited"
                  ? tr("ui.youReBeingRateLimitedPleaseWaitA")
                  : serverFailure.message ||
                    tr("ui.anErrorOccurredWhileLoadingServerDetails")}
              </span>
            </div>
            {!wasRefused && (
              <Button size="small"
                onClick={() => window.location.reload()}
                style={{ marginTop: 4 }}
              >
                <PiArrowsClockwiseFill size={16} />
                {tr("ui.retry")}
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
                {tr("ui.reconnectingVariant")}
              </span>
              <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
                {tr("ui.lostConnectionToTheServerAttemptingToReconnect")}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Refused on identity grounds, not a network fault. "The server may be offline"
  // would send someone to check their wifi over a security warning.
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
                {tr("ui.serverIdentityNotRecognised")}
              </span>
              <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
                {refusalReason ??
                  tr("ui.thisServerCouldNotProveItIsThe")}
              </span>
              {refusalHelpUrl && (
                <a
                  href={refusalHelpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline text-gryt-muted hover:text-gryt-text"
                >
                  {tr("ui.howToFixThis")}
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
                {tr("ui.serverUnreachable")}
              </span>
              <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
                {tr("ui.unableToEstablishAConnectionTheServerMay")}
              </span>
            </div>
            <Button size="small"
              onClick={onReconnect ?? (() => window.location.reload())}
              style={{ marginTop: 4 }}
            >
              <PiArrowsClockwiseFill size={16} />
              {tr("ui.reconnect")}
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
              {tr("ui.takingLongerThanExpected")}
            </span>
            <span className="text-sm text-gryt-muted" style={{ lineHeight: 1.5 }}>
              {tr("ui.theServerIsTakingAWhileToRespond")}
            </span>
          </div>
          <Button size="small"
            onClick={onReconnect ?? (() => window.location.reload())}
            style={{ marginTop: 4 }}
          >
            <PiArrowsClockwiseFill size={16} />
            {tr("ui.retry")}
          </Button>
        </div>
      </div>
    </div>
  );
};
