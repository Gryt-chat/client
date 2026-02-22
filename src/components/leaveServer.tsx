import { AlertDialog, Button, Flex } from "@radix-ui/themes";

import { useServerManagement } from "@/socket";

export function LeaveServer() {
  const { removeServer, showRemoveServer, setShowRemoveServer, servers } =
    useServerManagement();

  function handleRemoveServer(remove: boolean) {
    if (!showRemoveServer) return;

    if (remove) removeServer(showRemoveServer);
    setShowRemoveServer(null);
  }

  return (
    <AlertDialog.Root open={!!showRemoveServer}>
      <AlertDialog.Content maxWidth="450px">
        <AlertDialog.Title>
          Leave{" "}
          <strong>{showRemoveServer && servers[showRemoveServer].name}</strong>
        </AlertDialog.Title>
        <AlertDialog.Description size="2">
          Are you sure? You will lose access to all channels and messages in{" "}
          {showRemoveServer && servers[showRemoveServer].name}.
        </AlertDialog.Description>

        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel onClick={() => handleRemoveServer(false)}>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action onClick={() => handleRemoveServer(true)}>
            <Button variant="solid" color="red">
              Leave server
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
