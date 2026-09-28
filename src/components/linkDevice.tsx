/* Hallmark · component: dialog · genre: modern-minimal · theme: @gryt/ui (design.md)
 * states carried by @gryt/ui Button, Spinner and Alert; the QR is the one new element. */
import type { NewDeviceState, PairingEndReason } from "@gryt/core";
import { Alert, Button, Dialog, IconButton } from "@gryt/ui";
import { useMemo } from "react";
import { encode } from "uqr";

import { PiX } from "../lib/icons";
import { useLinkDevice } from "../lib/pairing/useLinkDevice";
import { useSecondsLeft } from "../lib/pairing/useSecondsLeft";
import { EmojiRow, Waiting } from "./pairingParts";

const ENDED: Partial<Record<PairingEndReason, string>> = {
  cancelled_by_other: "It was cancelled on the other device.",
  mismatch: "You said the emoji didn't match, so nothing was linked. Someone may have been in the middle of the connection.",
  timed_out: "The other device didn't approve in time.",
  expired: "The code ran out before anyone used it.",
  tampered: "A message from the other device didn't check out, so nothing was linked.",
  wrong_account: "You got signed in as a different account from the one on your other device. Nothing was kept.",
  sign_in_failed: "Signing in didn't finish, so nothing was kept on this device.",
  newer_version: "Your other device is on a newer version of Gryt. Update this one first.",
  rate_limited: "Too many tries from this network. Wait a few minutes.",
  relay_error: "Couldn't reach the linking service. Check your connection.",
};

/** Black on white whatever the theme: phone cameras read a light-on-dark code badly. */
function QrCode({ text }: { text: string }) {
  const path = useMemo(() => {
    const { data } = encode(text, { ecc: "M", border: 0 });
    let d = "";
    data.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
    return { d, size: data.length };
  }, [text]);

  return (
    <svg
      role="img"
      aria-label="Code to scan from your other device"
      viewBox={`-3 -3 ${path.size + 6} ${path.size + 6}`}
      className="h-52 w-52 rounded-[var(--gryt-radius-md)]"
      shapeRendering="crispEdges"
    >
      <rect x={-3} y={-3} width={path.size + 6} height={path.size + 6} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

function Body({ state, replaces }: { state: NewDeviceState | null; replaces: number }) {
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
            On a device where you already use Gryt, open Settings and choose Link a device. Scan this
            there, or type the code.
          </Dialog.Description>
          <QrCode text={state.qr} />
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
      return <Waiting>Signing in as {state.username}…</Waiting>;

    case "joining":
      return (
        <Waiting>
          Joining your {state.servers.length === 1 ? "server" : `${state.servers.length} servers`}…
        </Waiting>
      );

    case "linked":
    case "done":
      return (
        <div className="flex flex-col gap-3">
          <Dialog.Description className="m-0">
            This device is linked to {state.from}.
            {state.phase === "linked" && " Your other device is adding it to your conversations. You can use Gryt while that finishes."}
          </Dialog.Description>
          <div className="flex flex-wrap gap-2">
            {replaces > 0 ? (
              <Button size="small" onClick={() => window.location.reload()}>Restart Gryt</Button>
            ) : (
              <Button size="small" onClick={close}>Done</Button>
            )}
          </div>
        </div>
      );

    case "ended":
      return (
        <div className="flex flex-col gap-3">
          <Alert severity={state.reason === "mismatch" || state.reason === "tampered" ? "error" : "info"}>
            {ENDED[state.reason] ?? "Linking stopped before it finished."}
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button size="small" onClick={start}>Try again</Button>
            <Button size="small" tone="neutral" onClick={close}>Close</Button>
          </div>
        </div>
      );
  }
}

/** Link this device to one already signed in (GRYT-1484), from the new device's side. */
export function LinkDeviceDialog() {
  const { isOpen, state, replaces, close } = useLinkDevice();
  const title = state?.phase === "comparing" ? "Check the emoji" : "Link this device";

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
            <Body state={state} replaces={replaces} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
