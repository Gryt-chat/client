import { useSyncExternalStore } from "react";
import toast from "react-hot-toast";

import { FriendRequestCard } from "./FriendRequestCard";

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

/** The toast for a new request: who, which server, and Accept / Decline right there. */
export function showFriendRequestToast(host: string, serverUserId: string, name: string): void {
  const id = `friend:${host}:${serverUserId}`;
  toast(() => <FriendRequestCard id={id} host={host} serverUserId={serverUserId} name={name} />, { id, duration: 30_000, style: { maxWidth: "min(350px, calc(100vw - 2rem))", padding: 16, borderRadius: "var(--gryt-radius-xl)" } });
}
