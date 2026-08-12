import { Button, Dialog } from "@gryt/ui";

import { useServerManagement } from "@/socket";

export function LeaveServer() {
  const { removeServer, showRemoveServer, setShowRemoveServer, servers } =
    useServerManagement();

  function handleRemoveServer(remove: boolean) {
    if (!showRemoveServer) return;

    if (remove) removeServer(showRemoveServer);
    setShowRemoveServer(null);
  }

  const name = showRemoveServer && servers[showRemoveServer].name;

  return (
    /* Dismissing this is a cancel. The Radix AlertDialog it replaces had no
       onOpenChange at all, so Esc and the backdrop did nothing and the only way
       out was the button — which is worse than it sounds on a dialog whose
       other option is destructive. */
    <Dialog.Root
      open={!!showRemoveServer}
      onOpenChange={(open) => {
        if (!open) handleRemoveServer(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)]">
          <Dialog.Title>
            Leave <strong>{name}</strong>
          </Dialog.Title>
          <Dialog.Description className="mt-2">
            Are you sure? You will lose access to all channels and messages in{" "}
            {name}.
          </Dialog.Description>

          <Dialog.Footer>
            <Button tone="ghost" onClick={() => handleRemoveServer(false)}>
              Cancel
            </Button>
            <Button tone="danger" onClick={() => handleRemoveServer(true)}>
              Leave server
            </Button>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
