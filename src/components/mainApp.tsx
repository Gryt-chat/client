import { Button } from "@gryt/ui";
import { Flex, Heading, Text } from "@radix-ui/themes";

import { useSettings } from "@/settings";
import { useServerManagement } from "@/socket";
import { ServerView } from "@/socket/src/components/serverView";

import { OnboardingTour } from "./onboarding/OnboardingTour";
import { Sidebar } from "./sidebar";

export function MainApp() {
  const { servers, setShowAddServer } = useServerManagement();
  const { showTour, dismissTour } = useSettings();

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
        /* Was a line of text with a finger emoji pointing at the sidebar, which
           is the tour's job now and was never a good one for a permanent empty
           state: it explained where a button was instead of offering the thing
           the button does. Somebody who dismissed the tour still ends up here,
           so this has to stand on its own. */
        <Flex flexGrow="1" align="center" justify="center">
          <Flex
            direction="column"
            align="center"
            gap="3"
            style={{ maxWidth: "24rem", textAlign: "center" }}
          >
            <Heading size="4">Nothing here yet</Heading>
            <Text size="2" color="gray">
              Gryt is empty until you join a server. Add a friend&rsquo;s with an
              invite, or start one of your own.
            </Text>
            <Button onClick={() => setShowAddServer(true)}>Add a server</Button>
          </Flex>
        </Flex>
      )}

      {showTour && <OnboardingTour onFinish={dismissTour} />}
    </Flex>
  );
}
