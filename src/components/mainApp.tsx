import { Flex } from "@radix-ui/themes";

import { useServerManagement } from "@/socket";
import { ServerView } from "@/socket/src/components/serverView";

import { Sidebar } from "./sidebar";

export function MainApp() {
  const { servers, setShowAddServer } = useServerManagement();

  return (
    <Flex
      style={{ position: "absolute", inset: 0 }}
      gap="4"
      overflow="hidden"
      p="4"
    >
      <Sidebar setShowAddServer={setShowAddServer} />

      {Object.keys(servers).length > 0 ? (
        <ServerView />
      ) : (
        <Flex height="56px" align="center">
          👈 Add a server using this button
        </Flex>
      )}
    </Flex>
  );
}
