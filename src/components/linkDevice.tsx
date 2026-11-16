/* Hallmark · component: dialog · genre: modern-minimal · theme: @gryt/ui (design.md)
 * states carried by @gryt/ui Button, Spinner and Alert; the QR is the one new element. */
import { type HistoryProgress, type NewDeviceState, qrArt } from "@gryt/core";
import { Alert, Button, Dialog, IconButton, Progress } from "@gryt/ui";
import { useMemo, useRef } from "react";
import { encode } from "uqr";

import { LogoIcon } from "@/common";

import { PiX } from "../lib/icons";
import { type NewDeviceInFlight, newDeviceSteps, useWakeLock } from "../lib/pairing/linkSteps";
import { historyLines, historyStaysThere, newDeviceEndText } from "../lib/pairing/newDeviceWords";
import { useLinkDevice } from "../lib/pairing/useLinkDevice";
import { useSecondsLeft } from "../lib/pairing/useSecondsLeft";
import { EmojiRow, LinkSteps, Waiting } from "./pairingParts";

/** Black on white whatever the theme: phone cameras read a light-on-dark code badly. */
export function QrCode({
  text,
  label = "Code to scan from your other device",
  className = "h-52 w-52",
}: { text: string; label?: string; className?: string }) {
  // Level H: the owl covers the middle, and H still reads with about 30% of the code missing.
  const art = useMemo(() => qrArt(encode(text, { ecc: "H", border: 0 }).data), [text]);
  const box = art.size + 6;

  return (
    <svg role="img" aria-label={label} viewBox={`-3 -3 ${box} ${box}`} className={className}>
      <rect x={-3} y={-3} width={box} height={box} rx={3} fill="#fff" />
      <path d={art.finders + art.dots} fill="#000" />
      {art.logo && (
        <g transform={`translate(${art.logo.x} ${art.logo.y})`}>
          <LogoIcon size={art.logo.size} />
        </g>
      )}
    </svg>
  );
}

function History({ progress }: { progress: HistoryProgress | null }) {
  const lines = historyLines(progress);
  if (!progress || !lines.length) return null;
  const share = progress.total ? Math.min(progress.messages, progress.total) / progress.total : null;
  return (
    <div className="flex flex-col gap-2" role="status">
      {lines.map((line) => (
        <span key={line} className="text-sm">{line}</span>
      ))}
      {!progress.complete && <Progress value={share === null ? null : share * 100} aria-label="History received" />}
    </div>
  );
}

function HistoryLeftBehind({ from }: { from: string }) {
  const { historyLeftBehind } = useLinkDevice();
  return historyLeftBehind ? <span className="text-sm text-gryt-muted">{historyStaysThere(from)}</span> : null;
}

function NewDeviceSteps({ state, history }: { state: NewDeviceInFlight; history: HistoryProgress | null }) {
  const signedIn = useRef(false);
  if (state.phase === "signing_in") signedIn.current = true;
  return (
    <div className="flex flex-col gap-3">
      <LinkSteps steps={newDeviceSteps(state, signedIn.current)} />
      <History progress={history} />
      <HistoryLeftBehind from={state.from} />
    </div>
  );
}

function Linked({ state, replaces, history, close }: {
  state: Extract<NewDeviceState, { phase: "linked" | "done" }>;
  replaces: number;
  history: HistoryProgress | null;
  close: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {state.phase === "linked" ? (
        <NewDeviceSteps state={state} history={history} />
      ) : (
        <>
          <Dialog.Description className="m-0">
            This device is linked to {state.from}.{replaces > 0 && " Restarting Gryt\u2026"}
          </Dialog.Description>
          <History progress={history} />
          <HistoryLeftBehind from={state.from} />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {replaces > 0 && state.phase === "linked" && (
          // A restart now would leave the rest of the history behind.
          <span className="text-sm text-gryt-muted">Gryt restarts by itself once it&rsquo;s done.</span>
        )}
        {replaces > 0 && state.phase === "done" && (
          <Button size="small" onClick={() => window.location.reload()}>Restart now</Button>
        )}
        {replaces === 0 && (
          <Button size="small" onClick={close}>{state.phase === "linked" ? "Use Gryt while this finishes" : "Done"}</Button>
        )}
      </div>
    </div>
  );
}

function Body({ state, replaces, history }: { state: NewDeviceState | null; replaces: number; history: HistoryProgress | null }) {
  const { start, close, mismatch } = useLinkDevice();
  const secondsLeft = useSecondsLeft(state?.phase === "comparing" ? state.deadline : null);

  if (!state) {
    return (
      <div className="flex flex-col gap-3">
        <Alert severity="warning">
          You&rsquo;ve already used Gryt on this device. Linking swaps its identity for the one on your other
          device. Servers you joined here as a guest will see you as someone new.
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button size="small" onClick={start}>Link anyway</Button>
          <Button size="small" tone="neutral" onClick={close}>Cancel</Button>
        </div>
      </div>
    );
  }

  switch (state.phase) {
    case "idle":
    case "opening":
      return <Waiting>Getting a code…</Waiting>;

    case "showing":
      return (
        <div className="flex flex-col items-center gap-4">
          <Dialog.Description className="m-0 self-stretch">
            Point your phone&rsquo;s camera at this. Gryt opens there and asks &ldquo;Is this your
            computer?&rdquo;. Check the pictures match, tap Approve, and you&rsquo;re done.
          </Dialog.Description>
          <QrCode text={`gryt://link?p=${encodeURIComponent(state.qr)}`} />
          <span className="text-sm text-gryt-muted">Or on your other device, open Link a device and type</span>
          <code className="font-mono text-2xl tracking-[0.2em] text-gryt-text select-all" aria-label="Code to type">
            {state.code}
          </code>
          {state.renewed === "timed_out" && (
            <span className="text-xs text-gryt-muted">The last one wasn&rsquo;t approved in time, so this is a new code.</span>
          )}
          <Waiting>Waiting for your other device…</Waiting>
        </div>
      );

    case "comparing":
      return (
        <div className="flex flex-col gap-4">
          <Dialog.Description className="m-0">
            Approve on your other device if it shows the same four.
          </Dialog.Description>
          <EmojiRow emoji={state.emoji} />
          <span className="text-xs text-gryt-muted" aria-live="off">
            {secondsLeft > 0 ? `${secondsLeft} seconds left to approve.` : "Time's up."}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button size="small" tone="danger" onClick={mismatch}>They don&rsquo;t match</Button>
            <Button size="small" tone="neutral" onClick={close}>Cancel</Button>
          </div>
        </div>
      );

    case "signing_in":
    case "joining":
      return <NewDeviceSteps state={state} history={history} />;

    case "linked":
    case "done":
      return <Linked state={state} replaces={replaces} history={history} close={close} />;

    case "ended":
      return (
        <div className="flex flex-col gap-3">
          <Alert severity={state.reason === "mismatch" || state.reason === "tampered" ? "error" : "info"}>
            {newDeviceEndText(state.reason, state.detail)}
          </Alert>
          <div className="flex flex-wrap gap-2">
            {state.reason === "history_failed" ? (
              replaces > 0 && <Button size="small" onClick={() => window.location.reload()}>Restart Gryt</Button>
            ) : (
              <Button size="small" onClick={start}>Try again</Button>
            )}
            <Button size="small" tone="neutral" onClick={close}>Close</Button>
          </div>
        </div>
      );
  }
}

/** Link this device to one already signed in (GRYT-1484), from the new device's side. */
export function LinkDeviceDialog() {
  const { isOpen, state, replaces, history, close } = useLinkDevice();
  useWakeLock(isOpen && !!state && state.phase !== "done" && state.phase !== "ended");
  const titles: Partial<Record<NonNullable<typeof state>["phase"], string>> = {
    showing: "Approve this computer from your phone",
    comparing: "Check the pictures match",
  };
  const title = (state && titles[state.phase]) ?? "Link this device";

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[26rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <Dialog.Close className="absolute top-3 right-3" render={<IconButton size="small" aria-label="Close" />}>
            <PiX size={16} />
          </Dialog.Close>
          <Dialog.Title className="pr-10">{title}</Dialog.Title>
          <div className="mt-3">
            <Body state={state} replaces={replaces} history={history} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
