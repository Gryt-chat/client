import { Button, Checkbox, Dialog } from "@gryt/ui";
import { useEffect } from "react";
import { PiSquaresFourFill } from "react-icons/pi";

import { useScreenAudioSources } from "../adapters/useScreenAudioSources";

interface ScreenAudioSourcesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Which applications a running screen share takes audio from.
 *
 * Only reachable where the OS can do it, which today means Windows — the
 * button that opens this is hidden otherwise, so nothing here has to explain
 * the platform.
 */
export function ScreenAudioSourcesModal({ open, onOpenChange }: ScreenAudioSourcesModalProps) {
  const { wholeMachine, apps, refresh, setCaptured, captureWholeMachine } = useScreenAudioSources();

  // Windows come and go while a call is running, so the list is read when it
  // is opened rather than held.
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup style={{ maxWidth: 460 }}>
          <Dialog.Title>Audio you&apos;re sharing</Dialog.Title>
          <Dialog.Description>
            Pick the applications to send. Anything you leave out stays out of the share,
            including a voice app you're in.
          </Dialog.Description>

          <div className="flex flex-col gap-2 py-3">
            <label
              className="text-sm"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                padding: "6px 8px",
                borderRadius: "var(--gryt-radius-md)",
                background: wholeMachine ? "var(--gryt-accent-3)" : "var(--gryt-neutral-3)",
              }}
            >
              <Checkbox
                checked={wholeMachine}
                onCheckedChange={(v) => {
                  if (v === true) void captureWholeMachine();
                }}
              />
              Everything except Gryt
            </label>

            <div
              className="flex flex-col gap-1"
              style={{ maxHeight: 260, overflowY: "auto" }}
            >
              {apps.length === 0 && (
                <span className="text-sm text-gryt-muted" style={{ padding: 12, textAlign: "center" }}>
                  No open windows found
                </span>
              )}

              {apps.map((app) => (
                <label
                  key={app.id}
                  className="text-sm"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    padding: "6px 8px",
                    borderRadius: "var(--gryt-radius-md)",
                    background: app.captured ? "var(--gryt-accent-3)" : "var(--gryt-neutral-3)",
                  }}
                >
                  <Checkbox
                    checked={app.captured}
                    onCheckedChange={(v) => void setCaptured(app.id, v === true)}
                  />
                  {app.appIcon ? (
                    <img src={app.appIcon} alt="" style={{ width: 16, height: 16 }} draggable={false} />
                  ) : (
                    <PiSquaresFourFill size={16} />
                  )}
                  <span className="truncate" style={{ flex: 1 }}>{app.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="small" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
