import { Popover, Select } from "@gryt/ui";
import { useSpeakers } from "@gryt/voice";
import { useEffect } from "react";

import { setNotificationOutputDevice } from "@/lib/notificationSound";
import { useSettings } from "@/settings";

import { PiArrowRightBold } from "../../../../lib/icons";
import { type CallControlState, SplitArrow } from "./CallControlButton";
import { CALL_MENU_STYLE } from "./MicMenu";

/** The headset's arrow and its menu: where everyone's voice plays. */
export function HeadsetMenu({ state, open, onOpenChange }: {
  state: CallControlState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { outputDeviceID, setOutputDeviceID, openSettings } = useSettings();
  const { devices, getOutputDevices, applyOutputDevice } = useSpeakers();

  // Read again on every open, so a headset plugged in mid-call is there.
  useEffect(() => {
    if (open) void getOutputDevices();
  }, [open, getOutputDevices]);

  const pick = (id: string) => {
    setOutputDeviceID(id);
    applyOutputDevice(id);
    setNotificationOutputDevice(id);
  };

  const options = [
    { label: "Default", value: "default" },
    ...devices
      .filter((d) => d.deviceId && d.deviceId !== "default")
      .map((d, i) => ({ label: d.label || `Speaker ${i + 1}`, value: d.deviceId })),
  ];

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger render={<SplitArrow state={state} open={open} aria-label="Speaker options" />} />
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={12}>
          <Popover.Popup aria-label="Speaker" initialFocus={(type) => type === "keyboard"} style={CALL_MENU_STYLE}>
            <div className="px-2.5 pt-2 pb-1 text-xs font-bold text-gryt-muted">Speaker</div>
            <div className="px-2.5 pt-0.5 pb-1.5">
              <Select
                aria-label="Speaker"
                value={outputDeviceID || "default"}
                onValueChange={(v) => pick(String(v))}
                options={options}
                size="small"
                className="w-full"
              />
            </div>
            <div className="mx-1 my-1.5 h-px bg-gryt-neutral-6" />
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between rounded-[10px] border-0 bg-transparent px-2.5 py-2 text-left text-sm text-gryt-muted hover:bg-gryt-neutral-4 hover:text-gryt-text"
              onClick={() => {
                onOpenChange(false);
                openSettings("audio");
              }}
            >
              Open audio settings
              <PiArrowRightBold size={12} />
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
