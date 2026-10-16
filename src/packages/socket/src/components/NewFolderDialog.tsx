import { Button, Dialog, IconButton, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

import { PiX } from "../../../../lib/icons";

/** Names a folder before it exists, the way Create channel does (GRYT-1787). */
export function NewFolderDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const trimmed = name.trim();
  const create = () => {
    if (!trimmed) return;
    onCreate(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Dialog.Title style={{ margin: 0 }}>New folder</Dialog.Title>
              <Dialog.Close>
                <IconButton size="xsmall" aria-label="Close"><PiX size={16} /></IconButton>
              </Dialog.Close>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Folder name</span>
              <TextField
                aria-label="Folder name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }}
                placeholder="Games"
                maxLength={100}
                autoFocus
              />
            </div>

            <div className="flex flex-wrap justify-end gap-3" style={{ marginTop: 4 }}>
              <Button tone="neutral" size="small" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="small" onClick={create} disabled={!trimmed}>
                Create folder
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
