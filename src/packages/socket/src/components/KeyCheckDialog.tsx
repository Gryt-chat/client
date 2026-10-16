import { Button, Dialog, IconButton } from "@gryt/ui";
import { type ReactNode, useEffect, useState } from "react";

import { PiShieldWarningFill, PiX } from "../../../../lib/icons";
import { useKeyCheck } from "../hooks/useKeyCheck";

interface KeyCheckRequest {
  host: string;
  serverUserId: string;
  nickname: string;
}

const OPEN_EVENT = "gryt:key-check";

/** Opens the step-by-step check for somebody whose key changed (GRYT-1789). */
export function openKeyCheck(request: KeyCheckRequest) {
  window.dispatchEvent(new CustomEvent<KeyCheckRequest>(OPEN_EVENT, { detail: request }));
}

/** Mounted once; the header and the composer open it with `openKeyCheck`. */
export function KeyCheckDialog() {
  const [request, setRequest] = useState<KeyCheckRequest | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setRequest((e as CustomEvent<KeyCheckRequest>).detail);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  return (
    <Dialog.Root open={!!request} onOpenChange={(open) => !open && setRequest(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[34rem]">
          {request && <Steps request={request} onClose={() => setRequest(null)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Steps({ request, onClose }: { request: KeyCheckRequest; onClose: () => void }) {
  const { host, serverUserId, nickname: name } = request;
  const { changed, newCode, trustNewKey } = useKeyCheck(host, serverUserId, name);
  const [mismatch, setMismatch] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Dialog.Title style={{ margin: 0 }}>Check {name}&rsquo;s key</Dialog.Title>
        <Dialog.Close>
          <IconButton size="xsmall" aria-label="Close"><PiX size={16} /></IconButton>
        </Dialog.Close>
      </div>

      {!changed ? (
        <>
          <p className="m-0 text-sm" style={{ color: "var(--gryt-neutral-11)" }}>
            {name}&rsquo;s key is checked. You can message them again.
          </p>
          <div className="flex justify-end">
            <Button size="small" onClick={onClose}>Done</Button>
          </div>
        </>
      ) : mismatch ? (
        <>
          <p className="m-0 flex items-start gap-2 text-sm" style={{ color: "var(--gryt-neutral-11)" }}>
            <PiShieldWarningFill size={18} style={{ color: "var(--gryt-danger-9)", flexShrink: 0, marginTop: 1 }} />
            <span>
              Don&rsquo;t trust it. Somebody may be pretending to be {name}, so Gryt keeps holding your messages to
              them. Tell {name} somewhere other than Gryt, and tell whoever runs this server.
            </span>
          </p>
          <div className="flex justify-end gap-3">
            <Button tone="neutral" size="small" onClick={() => setMismatch(false)}>Back</Button>
            <Button size="small" onClick={onClose}>Close</Button>
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-sm" style={{ color: "var(--gryt-neutral-11)" }}>
            {name}&rsquo;s key changed. Usually that means they set Gryt up again on a new device. It&rsquo;s also what
            it would look like if somebody was pretending to be them, so Gryt holds your messages to them until you&rsquo;ve
            checked.
          </p>

          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            <Step n={1} title={`Get hold of ${name} somewhere other than Gryt`}>
              A call, a text or in person. Not in Gryt, since Gryt is what you&rsquo;re checking.
            </Step>
            <Step n={2} title="Compare this code">
              Ask them to open your card in Gryt and read out the code under &ldquo;Check this is really them&rdquo;.
              {newCode ? (
                <code
                  className="mt-2 block rounded-(--gryt-radius-md) px-3 py-2 text-center"
                  style={{ background: "var(--gryt-neutral-3)", letterSpacing: ".06em", fontFamily: "var(--code-font-family)" }}
                >
                  {newCode}
                </code>
              ) : (
                <span className="mt-2 block" style={{ color: "var(--gryt-neutral-10)" }}>Working out the code…</span>
              )}
            </Step>
            <Step n={3} title="If every number matches, trust the new key">
              One number different means it isn&rsquo;t them.
            </Step>
          </ol>

          <div className="flex flex-wrap justify-end gap-3">
            <Button tone="neutral" size="small" onClick={() => setMismatch(true)}>They don&rsquo;t match</Button>
            <Button size="small" disabled={!newCode} onClick={trustNewKey} data-gryt="trust-new-key">
              The codes match, trust it
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{ background: "var(--gryt-accent-a4)", color: "var(--gryt-accent-11)" }}
      >
        {n}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 text-sm">
        <b>{title}</b>
        <span style={{ color: "var(--gryt-neutral-11)" }}>{children}</span>
      </span>
    </li>
  );
}
