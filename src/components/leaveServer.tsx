import { Button, Dialog } from "@gryt/ui";

import { useServerManagement, useSockets } from "@/socket";

/**
 * Confirms one of the two ways out of a server. Removing is local and reversible;
 * leaving ends the membership, and an invite-only server may have no way back.
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
    /* Dismissing this is a cancel. The dialog it replaces had no onOpenChange, so
       the only way out was the button — worse on a dialog with a destructive option. */
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
