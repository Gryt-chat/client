import { Button } from "@gryt/ui";
import toast from "react-hot-toast";

import { groupLinkedDeviceNotices, linkedDeviceLine, type LinkedDeviceNotice, linkedDeviceNotices } from "../mls/linkedDevices";
import { openUserSettings } from "./dmKeyWarningToast";

/** The live half of "New device linked". Settings, Security keeps it until it's dismissed there.
    One toast per device: the same install turning up on each server redraws it rather than stacking. */
export function showLinkedDeviceToast(notice: LinkedDeviceNotice): void {
  const group = groupLinkedDeviceNotices(linkedDeviceNotices.get()).find((g) => g.notices.some((n) => n.deviceId === notice.deviceId));
  // The group's key follows the server's addedAt, which can put a later notice first, so drop the others by id.
  for (const n of group?.notices ?? []) if (n.deviceId !== notice.deviceId) toast.dismiss(`linked-device-${n.deviceId}`);
  const id = `linked-device-${notice.deviceId}`;
  const servers = group?.notices.length ?? 1;
  toast(
    () => (
      <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
        <span className="text-sm" style={{ lineHeight: 1.5 }}>
          {linkedDeviceLine(notice, false)}
          {servers > 1 ? ` It's on ${servers} of your servers.` : ""}
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
