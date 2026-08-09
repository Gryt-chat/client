import { Button, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { FaGithub } from "react-icons/fa";
import { PiArrowSquareOutFill } from "react-icons/pi";
import { SiKofi } from "react-icons/si";

import { SettingsContainer } from "./settingsComponents";

const GITHUB_URL = "https://github.com/Gryt-chat/gryt";
const KOFI_URL = "https://ko-fi.com/sivert";

export function SupportSettings() {
  return (
    <SettingsContainer>
      <Heading size="4">Support Gryt</Heading>

      <Text size="2" color="gray">
        Gryt is free and open source. Stars and donations help keep it going.
      </Text>

      <Card size="2">
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <FaGithub size={18} />
            <Text size="3" weight="medium">Star on GitHub</Text>
          </Flex>
          <Text size="2" color="gray">
            A star helps others discover Gryt and shows that people find it
            useful.
          </Text>
          <Button variant="soft" size="2" asChild>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <FaGithub size={16} />
              Star on GitHub
              <PiArrowSquareOutFill size={14} />
            </a>
          </Button>
        </Flex>
      </Card>

      <Card size="2">
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <SiKofi size={18} />
            <Text size="3" weight="medium">Donate on Ko-fi</Text>
          </Flex>
          <Text size="2" color="gray">
            Donations go directly toward hosting, development, and keeping Gryt
            free for everyone.
          </Text>
          <Button variant="soft" size="2" asChild>
            <a href={KOFI_URL} target="_blank" rel="noopener noreferrer">
              <SiKofi size={16} />
              Donate on Ko-fi
              <PiArrowSquareOutFill size={14} />
            </a>
          </Button>
        </Flex>
      </Card>
    </SettingsContainer>
  );
}
