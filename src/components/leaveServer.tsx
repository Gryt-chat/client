import { Button, Dialog } from "@gryt/ui";

import { useServerManagement, useSockets } from "@/socket";

/**
 * Confirms one of the two ways out of a server.
 *
 * They are worth keeping apart in the copy, because they look identical from
 * the rail and are not at all the same afterwards. Removing is local and
 * reversible by adding the server back. Leaving ends the membership, and if the
 * server admits people by invite there may be no way back in.
 */
export function LeaveServer() {
  const { removeServer, showRemoveServer, setShowRemoveServer, servers } =
    useServerManagement();
  const { leaveServer } = useSockets();

  function close() {
    setShowRemoveServer(null);
  }

  function confirm() {
    if (!showRemoveServer) return;
    const { host, mode } = showRemoveServer;
    // Leaving removes the entry itself, once the server has answered. Doing it
    // here as well would close the socket before the emit got out.
    if (mode === "leave") leaveServer(host);
    else removeServer(host);
    setShowRemoveServer(null);
  }

  const host = showRemoveServer?.host;
  const name = (host && servers[host]?.name) || host;
  const leaving = showRemoveServer?.mode === "leave";

  return (
    /* Dismissing this is a cancel. The Radix AlertDialog it replaces had no
       onOpenChange at all, so Esc and the backdrop did nothing and the only way
       out was the button — which is worse than it sounds on a dialog whose
       other option is destructive. */
    <Dialog.Root
      open={!!showRemoveServer}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)]">
          <Dialog.Title>
            {leaving ? "Leave" : "Remove"} <strong>{name}</strong>
          </Dialog.Title>
          <Dialog.Description className="mt-2">
            {leaving ? (
              <>
                You stop being a member of {name}. Your messages stay and keep
                your name on them, but your picture there is deleted, and if the
                server is invite-only you will need a new invite to come back.
              </>
            ) : (
              <>
                {name} goes from your sidebar. You are still a member, so you
                keep your roles and anything you own there. You just will not be
                connected: nobody sees you online, and changing your picture
                will not change it there.
              </>
            )}
          </Dialog.Description>

          <Dialog.Footer>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            {/* Danger for leaving only. Removing is reversible by adding the
                server back, and painting it red says otherwise. */}
            <Button tone={leaving ? "danger" : "primary"} onClick={confirm}>
              {leaving ? "Leave server" : "Remove from sidebar"}
            </Button>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
