import { Dialog, IconButton, TextField } from "@gryt/ui";
import { Flex } from "@radix-ui/themes";
import { useState } from "react";
import { PiX } from "react-icons/pi";

import { useSettings } from "../hooks/useSettings";

export function Nickname() {
  const { showNickname, setShowNickname, nickname, setNickname } =
    useSettings();
  const [newNick, setNewNick] = useState(nickname);

  function handleDialogChange(isOpen: boolean) {
    setShowNickname(isOpen);

    if (!isOpen && newNick.length > 0) {
      setNickname(newNick.substring(0, 20));
    } else {
      setNewNick(nickname);
    }
  }

  const handleEnterKey = (event: { key: string }) => {
    if (event.key === "Enter") {
      setShowNickname(false);
      setNickname(newNick.substring(0, 20));
    }
  };

  return (
    <Dialog.Root open={showNickname} onOpenChange={handleDialogChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="max-w-150">
        <Dialog.Close
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
          }}
        >
          <IconButton size="xsmall">
            <PiX size={16} />
          </IconButton>
        </Dialog.Close>
        <Flex direction="column" gap="2">
          <Dialog.Title>
            Set nickname
          </Dialog.Title>

          <TextField
            onKeyDown={handleEnterKey}
            placeholder="Unknown"
            max={20}
            maxLength={20}
            value={newNick}
            onChange={(e) => setNewNick(e.target.value)}
          />
        </Flex>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
