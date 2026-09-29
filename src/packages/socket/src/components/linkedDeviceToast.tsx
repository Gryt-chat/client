import { Button } from "@gryt/ui";
import toast from "react-hot-toast";

import { linkedDeviceLine, type LinkedDeviceNotice } from "../mls/linkedDevices";
import { openUserSettings } from "./dmKeyWarningToast";

/** The live half of "New device linked". Settings, Security keeps it until it's dismissed there. */
export function showLinkedDeviceToast(notice: LinkedDeviceNotice): void {
  const id = `linked-device-${notice.deviceId}`;
  toast(
    () => (
      <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
        <span className="text-sm" style={{ lineHeight: 1.5 }}>
          {linkedDeviceLine(notice, false)}
        </span>
        <div className="flex items-center gap-2" style={{ alignSelf: "flex-end" }}>
          <Button tone="neutral" size="xsmall" onClick={() => toast.dismiss(id)}>
            Close
          </Button>
          <Button
            size="xsmall"
            onClick={() => {
              toast.dismiss(id);
              openUserSettings("security");
            }}
          >
            Your devices
          </Button>
        </div>
      </div>
    ),
    { id, duration: 30_000 },
  );
}
