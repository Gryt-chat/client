import toast from "react-hot-toast";

import { DismissibleToast } from "./DismissibleToast";

/* Long enough to read and to cover the usual blip, short enough that a server
   that is gone does not leave a spinner sitting on your screen. */
export const RECONNECT_TOAST_MS = 6_000;

/* Raised from useSockets, which is a .ts file and cannot hold the markup. */
export function showReconnectingToast(toastId: string, serverName: string): void {
  toast.loading(
    <DismissibleToast
      message={`Reconnecting to ${serverName}...`}
      onDismiss={() => toast.dismiss(toastId)}
    />,
    { id: toastId, duration: RECONNECT_TOAST_MS },
  );
}

export function showReconnectGaveUpToast(toastId: string, serverName: string): void {
  toast.error(`Gave up reconnecting to ${serverName}. Open it to try again.`, {
    id: toastId,
    duration: 8_000,
  });
}
