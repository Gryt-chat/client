import { Button } from "@gryt/ui";
import toast from "react-hot-toast";

import type { OwnHandover } from "../mls/keyHandover";

/** This device asked to take over a server's key: where to approve it, and the code to check there. */
export function showHandoverWaiting(host: string, handover: OwnHandover): void {
  const id = `handover-waiting-${host}`;
  const on = handover.holder ? `On ${handover.holder}` : "On your other device";
  toast(
    () => (
      <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
        <span className="text-sm" style={{ lineHeight: 1.5 }}>
          {on}, approve this device for {host}. Check it shows{" "}
          <span className="font-mono font-semibold">{handover.code}</span> first.
        </span>
        <Button tone="neutral" size="xsmall" style={{ alignSelf: "flex-end" }} onClick={() => toast.dismiss(id)}>
          Close
        </Button>
      </div>
    ),
    { id, duration: Infinity },
  );
}

export function dismissHandoverWaiting(host: string): void {
  toast.dismiss(`handover-waiting-${host}`);
}
