import { Alert, Button, Dialog, IconButton, Spinner } from "@gryt/ui";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import type { LocaleMessage } from "../../../../lib/i18n";
import {
  PiArrowSquareOutBold,
  PiCheckCircleFill,
  PiMinusCircleFill,
  PiWarningCircleFill,
  PiX,
  PiXCircleFill,
} from "../../../../lib/icons";
import { useLocale } from "../../../../lib/localeContext";
import { useSockets } from "../hooks/useSockets";
import {
  type CheckResult,
  type CheckStatus,
  type DoctorRoomGrant,
  initialChecks,
  runDoctor,
  summarise,
} from "../lib/serverDoctor";

const ROOM_GRANT_TIMEOUT_MS = 8000;

/**
 * What is broken between here and one server, in connection order. The value is
 * the per-address breakdown: "none answered" differs from "not the LAN one".
 */

const ICON: Record<CheckStatus, ReactNode> = {
  pending: <PiMinusCircleFill className="text-gryt-muted" size={18} />,
  running: <Spinner size={16} />,
  pass: <PiCheckCircleFill className="text-gryt-success-9" size={18} />,
  warn: <PiWarningCircleFill className="text-gryt-warning-9" size={18} />,
  fail: <PiXCircleFill className="text-gryt-danger-9" size={18} />,
  skipped: <PiMinusCircleFill className="text-gryt-muted" size={18} />,
};

function CheckRow({ check, t }: { check: CheckResult; t: (message: LocaleMessage) => string }) {
  const dimmed = check.status === "pending" || check.status === "skipped";

  return (
    <div className="flex gap-2 items-start py-2 border-b border-gryt-border last:border-b-0">
      <span className="mt-0.5 shrink-0">{ICON[check.status]}</span>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span className={`text-sm ${dimmed ? "text-gryt-muted" : ""}`}>
          {t(check.label)}
        </span>

        {check.detail && (
          <span className="text-xs text-gryt-muted">{t(check.detail)}</span>
        )}

        {/* Every advertised address, pass or fail. The failures are the point,
            but showing only those would hide that the others were even tried,
            which is half the answer to "is my address list right". */}
        {check.addresses && check.addresses.length > 0 && (
          <div className="flex flex-col gap-0.5 mt-1">
            {check.addresses.map((address) => (
              <span key={address.address} className="text-xs font-mono">
                <span
                  className={
                    address.ok ? "text-gryt-success-9" : "text-gryt-danger-9"
                  }
                >
                  {t(address.ok ? "server.reachable" : "server.unreachable")}
                </span>{" "}
                <span className="text-gryt-muted">
                  {address.address}
                  {address.ok && ` — ${address.latencyMs} ms`}
                  {!address.ok && address.error && ` — ${t(address.error)}`}
                </span>
              </span>
            ))}
          </div>
        )}

        {check.help && (
          <a
            className="text-xs inline-flex items-center gap-1 mt-1"
            href={check.help.href}
            target="_blank"
            rel="noreferrer"
          >
            {t(check.help.label)}
            <PiArrowSquareOutBold size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

export function ServerDoctor({
  host,
  serverName,
  socketConnected,
  sfuHosts,
  stunHosts,
  open,
  onOpenChange,
}: {
  host: string;
  serverName: string;
  socketConnected: boolean;
  sfuHosts: string[];
  stunHosts: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const [checks, setChecks] = useState<CheckResult[]>(initialChecks);
  const [running, setRunning] = useState(false);
  const { sockets } = useSockets();
  const socket = sockets[host];

  /**
   * Ask the server for a room with nobody in it. Rejects with the server's own
   * words: refused permission is a different problem from an unreachable SFU.
   */
  const requestDoctorRoom = useCallback(
    () =>
      new Promise<DoctorRoomGrant>((resolve, reject) => {
        if (!socket) {
          reject(new Error("no connection to this server"));
          return;
        }

        const timer = setTimeout(() => {
          socket.off("voice:doctor:granted", onGranted);
          socket.off("voice:doctor:error", onError);
          // An older server has no handler for this and will never answer, so
          // silence has to be treated as an answer rather than hung on.
          reject(new Error("the server did not answer, so it may be too old to have a Doctor"));
        }, ROOM_GRANT_TIMEOUT_MS);

        function done() {
          clearTimeout(timer);
          socket?.off("voice:doctor:granted", onGranted);
          socket?.off("voice:doctor:error", onError);
        }

        function onGranted(grant: DoctorRoomGrant) {
          done();
          resolve(grant);
        }

        function onError(payload: { message?: string } | string) {
          done();
          reject(
            new Error(
              typeof payload === "string" ? payload : payload?.message ?? "refused",
            ),
          );
        }

        socket.once("voice:doctor:granted", onGranted);
        socket.once("voice:doctor:error", onError);
        socket.emit("voice:doctor:request");
      }),
    [socket],
  );

  const run = useCallback(() => {
    setRunning(true);
    setChecks(initialChecks());
    void runDoctor(
      {
        host,
        socketConnected,
        sfuHosts,
        stunHosts,
        // Only offered when the socket is up. Without one there is nobody to
        // ask for a room, and the check says so rather than failing.
        requestDoctorRoom: socketConnected ? requestDoctorRoom : undefined,
      },
      setChecks,
    ).finally(() => setRunning(false));
  }, [host, socketConnected, sfuHosts, stunHosts, requestDoctorRoom]);

  // Runs on open rather than behind a button. Somebody who chose "Doctor" has
  // already said what they want.
  useEffect(() => {
    if (open) run();
  }, [open, run]);

  const worst = running ? null : summarise(checks);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Close style={{ position: "absolute", top: "8px", right: "8px" }}>
            <IconButton tone="neutral" size="xsmall">
              <PiX size={16} />
            </IconButton>
          </Dialog.Close>

          <div className="flex flex-col gap-3">
            <Dialog.Title>{t("server.doctor")} — {serverName}</Dialog.Title>

            <Dialog.Description>
              {t("server.checksEachHopBetweenThisDeviceAndTheServerIn")}
            </Dialog.Description>

            <div className="flex flex-col">
              {checks.map((check) => (
                <CheckRow key={check.id} check={check} t={t} />
              ))}
            </div>

            {worst && worst.status === "fail" && (
              <Alert severity="error" role="alert">
                {t(worst.label)} {t("server.isTheFirstThingThatFailedFixingItMayFix")}
              </Alert>
            )}

            {!running && !worst && (
              <Alert severity="success" role="status">
                {t("server.everythingThisDeviceCanTestFromHereWorksIfVoice")}
              </Alert>
            )}

            <div className="flex justify-between items-center gap-2">
              {/* Said once, plainly, rather than as a caveat on the media row.
                  A renderer cannot send raw UDP, so nothing here can knock on
                  the server's media port and see who answers. Letting people
                  believe otherwise sends them to check the wrong thing. */}
              <span className="text-xs text-gryt-muted">
                {t("server.theseRunFromThisDeviceIntoARoomWithNobody")}
              </span>
              <Button size="small" disabled={running} onClick={run}>
                {running ? t("server.running") : t("server.runAgain")}
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
