/* Hallmark · component: dialog · genre: modern-minimal · theme: @gryt/ui (design.md)
 * states carried by @gryt/ui Button, TextField, Progress and Alert; nothing new drawn here. */
import type { ApproverState, PairingEndReason } from "@gryt/core";
import { parsePairingCode } from "@gryt/crypto";
import { Alert, Button, Dialog, IconButton, Progress, TextField } from "@gryt/ui";
import { useState } from "react";

import { useAccount } from "@/common";

import { PiX } from "../lib/icons";
import { useApproveDevice } from "../lib/pairing/useApproveDevice";
import { useSecondsLeft } from "../lib/pairing/useSecondsLeft";
import { EmojiRow, Waiting } from "./pairingParts";

const ENDED: Partial<Record<PairingEndReason, string>> = {
  cancelled: "Nothing was linked.",
  cancelled_by_other: "It was cancelled on the new device.",
  mismatch: "You said the emoji didn't match, so nothing was sent. Someone may have been in the middle of the connection.",
  timed_out: "It wasn't approved in time, so nothing was sent.",
  expired: "That code ran out. The new device shows a fresh one.",
  already_claimed: "Somebody else already entered this code. If that wasn't you, cancel on the new device.",
  unknown_code: "No device is showing that code. Check it, or wait for the new device to show a fresh one.",
  wrong_relay: "That code is for a different linking service from the one this device uses.",
  not_pairing: "That isn't a Gryt linking code.",
  newer_version: "The new device is on a newer version of Gryt. Update this one first.",
  tampered: "A message from the new device didn't check out, so nothing was sent.",
  rate_limited: "Too many tries from this network. Wait a few minutes.",
  relay_error: "Couldn't reach the linking service. Check your connection.",
  "approve:network": "Couldn't reach the sign-in server to approve the new device.",
  "approve:required_actions": "Your account has something to finish first, like verifying your email. Do that under Account, then try again.",
  "approve:rate_limited": "You've linked a lot of devices lately. Try again in an hour.",
  "approve:user_locked": "Your account is locked for now after too many sign-in attempts.",
};

function endedText(reason: PairingEndReason): string {
  if (ENDED[reason]) return ENDED[reason]!;
  if (reason.startsWith("approve:")) return `The sign-in server refused to sign in the new device (${reason.slice(8)}).`;
  return "Linking stopped before it finished.";
}

function CodeEntry() {
  const { claim, close } = useApproveDevice();
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);

  const submit = () => {
    if (!parsePairingCode(code)) return setWrong(true);
    claim(code);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Dialog.Description className="m-0">
        On the new device, choose Link with another device. Type the code it shows under the QR code.
      </Dialog.Description>
      <TextField
        label="Code"
        placeholder="XXXX-XXXX"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        value={code}
        error={wrong}
        helperText={wrong ? "That's 8 letters and numbers, like 7KQM-X4TD." : undefined}
        onChange={(e) => {
          setCode(e.target.value);
          setWrong(false);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="small" type="submit" disabled={!code.trim()}>Continue</Button>
        <Button size="small" tone="neutral" onClick={close}>Cancel</Button>
      </div>
    </form>
  );
}

function Confirm({ state }: { state: Extract<ApproverState, { phase: "confirming" }> }) {
  const { approve, deny, mismatch } = useApproveDevice();
  const { isSignedIn } = useAccount();
  const secondsLeft = useSecondsLeft(state.deadline);
  const { device } = state;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm">
          <strong>{device.name || "A device"}</strong>
          {device.app && `, ${device.app}`}
          {device.platform && ` on ${device.platform}`}
        </span>
        <span className="text-xs text-gryt-muted">
          {state.location ? `Near ${state.location}.` : "Its location is unknown."}
          {state.yourLocation && ` You're near ${state.yourLocation}.`}
        </span>
      </div>
      <EmojiRow emoji={state.emoji} />
      <Alert severity="warning">
        This device gets your messages, your keys and {isSignedIn ? "your account" : "your servers"}. Only approve
        a device that&rsquo;s in front of you, and only if it shows the same emoji. Gryt never asks you to type or
        scan a code from somebody else&rsquo;s device or a website.
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button size="small" onClick={approve} disabled={secondsLeft === 0}>
          {secondsLeft > 0 ? `Approve (${secondsLeft})` : "Time's up"}
        </Button>
        <Button size="small" tone="neutral" onClick={() => void deny()}>Deny</Button>
        <Button size="small" tone="ghost" onClick={() => void mismatch()}>They don&rsquo;t match</Button>
      </div>
    </div>
  );
}

function Body() {
  const { state, failure, open, close } = useApproveDevice();

  if (failure) {
    return (
      <div className="flex flex-col gap-3">
        <Alert severity="error">Nothing was sent. {failure}</Alert>
        <Button size="small" tone="neutral" style={{ alignSelf: "flex-start" }} onClick={close}>Close</Button>
      </div>
    );
  }
  if (!state || state.phase === "idle") return <CodeEntry />;

  switch (state.phase) {
    case "claiming":
      return <Waiting>Finding the new device…</Waiting>;
    case "waiting":
      return <Waiting>Waiting for the new device…</Waiting>;
    case "confirming":
      return <Confirm state={state} />;
    case "signing_in":
      return <Waiting>Signing in {state.device.name}…</Waiting>;
    case "browser":
      return (
        <div className="flex flex-col gap-3">
          <Dialog.Description className="m-0">
            Your sign-in server can&rsquo;t approve this from inside Gryt, so it opened in your browser. Choose Yes
            there, then come back here.
          </Dialog.Description>
          <Waiting>Waiting for {state.device.name} to sign in…</Waiting>
        </div>
      );
    case "waiting_ready":
      return <Waiting>Waiting for {state.device.name} to join your servers…</Waiting>;
    case "adding":
      return (
        <div className="flex flex-col gap-2" role="status">
          <span className="text-sm">
            Adding {state.device.name} to your conversations: {state.done} of {state.total}.
          </span>
          <Progress value={state.total ? (state.done / state.total) * 100 : null} aria-label="Conversations done" />
        </div>
      );
    case "done": {
      const failed = Object.values(state.added).flat().filter((a) => a.outcome === "failed").length;
      return (
        <div className="flex flex-col gap-3">
          <Dialog.Description className="m-0">
            {state.device.name} is linked.
            {failed > 0 &&
              ` It couldn't be added to ${failed === 1 ? "one conversation" : `${failed} conversations`} yet. It joins ${failed === 1 ? "that one" : "those"} the next time someone sends a message there.`}
          </Dialog.Description>
          <Button size="small" style={{ alignSelf: "flex-start" }} onClick={close}>Done</Button>
        </div>
      );
    }
    case "ended":
      return (
        <div className="flex flex-col gap-3">
          <Alert severity={state.reason === "mismatch" || state.reason === "tampered" ? "error" : "info"}>
            {endedText(state.reason)}
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button size="small" onClick={open}>Try again</Button>
            <Button size="small" tone="neutral" onClick={close}>Close</Button>
          </div>
        </div>
      );
  }
}

/** Link a new device to this one (GRYT-1484), from the side that's already signed in. */
export function ApproveDeviceDialog() {
  const { isOpen, state, close } = useApproveDevice();
  const title = state?.phase === "confirming" ? "Link this device?" : "Link a new device";

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <Dialog.Close className="absolute top-3 right-3" render={<IconButton size="small" aria-label="Close" />}>
            <PiX size={16} />
          </Dialog.Close>
          <Dialog.Title className="pr-10">{title}</Dialog.Title>
          <div className="mt-3">
            <Body />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
