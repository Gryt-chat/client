import { Button, Dialog, IconButton, TextField } from "@gryt/ui";
import { useState } from "react";
import toast from "react-hot-toast";

import { PiX } from "../../../../lib/icons";
import { bridgeFetch } from "./discordBridgeApi";

/** A member enters the code `/link` gave them on Discord, and their Discord messages show under them. */
export function DiscordLinkDialog({ host, open, onOpenChange }: { host: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await bridgeFetch(host, "/link", { method: "POST", body: JSON.stringify({ code }) });
      const body = (await res.json().catch(() => ({}))) as { discordName?: string; message?: string };
      if (!res.ok) {
        toast.error(body.message ?? "That code didn't work. Run /link on Discord again for a new one.");
        return;
      }
      toast.success(`Linked. Messages from ${body.discordName ?? "your Discord account"} now show as yours.`);
      setCode("");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex items-center justify-between">
              <Dialog.Title style={{ margin: 0 }}>Link your Discord account</Dialog.Title>
              <Dialog.Close>
                <IconButton size="xsmall"><PiX size={16} /></IconButton>
              </Dialog.Close>
            </div>
            <span className="text-sm text-gryt-muted">
              Run /link on the bot in this server&rsquo;s Discord. It gives you a code only you can see. Enter it here and your Discord messages show under your name.
            </span>
            <TextField label="Code" placeholder="ABCD2345" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="small" tone="ghost" type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button size="small" type="submit" disabled={busy}>Link</Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
