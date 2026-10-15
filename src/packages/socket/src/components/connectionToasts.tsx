import toast from "react-hot-toast";

export function showReconnectGaveUpToast(toastId: string, serverName: string): void {
  toast.error(`Gave up reconnecting to ${serverName}. Open it to try again.`, {
    id: toastId,
    duration: 8_000,
  });
}
