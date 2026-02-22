import { Dialog, Flex, IconButton, TextField } from "@radix-ui/themes";
import { useState } from "react";
import { FiX } from "react-icons/fi";

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
      <Dialog.Content maxWidth="600px">
        <Dialog.Close
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
          }}
        >
          <IconButton variant="soft" color="gray">
            <FiX size={16} />
          </IconButton>
        </Dialog.Close>
        <Flex direction="column" gap="2">
          <Dialog.Title as="h1" weight="bold" size="6">
            Set nickname
          </Dialog.Title>

          <TextField.Root
            onKeyDown={handleEnterKey}
            radius="full"
            placeholder="Unknown"
            max={20}
            maxLength={20}
            value={newNick}
            onChange={(e) => setNewNick(e.target.value)}
          />
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
