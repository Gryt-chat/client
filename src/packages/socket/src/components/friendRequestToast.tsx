import { Button } from "@gryt/ui";
import { useSyncExternalStore } from "react";
import toast from "react-hot-toast";

/* Whose request is open, from the toast. A store, so a toast outside React can open it. */
let open: { host: string; serverUserId: string } | null = null;
const listeners = new Set<() => void>();

export function setFriendRequestOpen(next: typeof open): void {
  open = next;
  for (const listener of listeners) listener();
}

export function useOpenFriendRequest(): typeof open {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
  );
}

/** The toast for a new request, with a button that opens their card instead of nothing. */
export function showFriendRequestToast(host: string, serverUserId: string, name: string, serverName: string): void {
  toast(
    (t) => (
      <span className="flex items-center gap-3">
        <span>{`${name} wants to be friends, on ${serverName}.`}</span>
        <Button
          size="small"
          onClick={() => {
            toast.dismiss(t.id);
            setFriendRequestOpen({ host, serverUserId });
          }}
        >
          See who it is
        </Button>
      </span>
    ),
    { id: `friend:${host}:${serverUserId}`, duration: 10_000 },
  );
}
