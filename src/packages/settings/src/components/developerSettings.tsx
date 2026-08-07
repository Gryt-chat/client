import { Badge, Flex, Heading, Separator, Text } from "@radix-ui/themes";

import { useSettings } from "@/settings";

import {
  SettingGroup,
  SettingsContainer,
  SliderSetting,
  ToggleSetting,
} from "./settingsComponents";

/** Names are assigned in order, so this bounds the participant slider. */
const MAX_FAKE_PARTICIPANTS = 12;

/**
 * Developer tools. Rendered only under `import.meta.env.DEV`, which Vite
 * constant-folds to false in a production build, so the whole panel and its
 * tab disappear from a release.
 */
export function DeveloperSettings() {
  const {
    devFakeParticipants,
    setDevFakeParticipants,
    devFakeMuted,
    setDevFakeMuted,
    devFakeScreenShare,
    setDevFakeScreenShare,
  } = useSettings();

  return (
    <SettingsContainer>
      <Flex align="center" gap="2">
        <Heading size="4">Developer</Heading>
        <Badge color="orange" variant="soft">
          Dev build only
        </Badge>
      </Flex>

      <Text size="1" color="gray">
        These do not exist in a release build.
      </Text>

      <Separator size="4" />

      <SettingGroup
        title="Fake participants"
        description="Invents people in whatever voice channel you are in, so the grid can be seen at counts a single account cannot reach — the server allows one voice connection per user, so a second tab gets kicked. They render through the real voice view with real providers, so this proves layout and nothing about the socket path."
      >
        <SliderSetting
          title="Extra participants"
          description={
            devFakeParticipants === 0
              ? "Off — only real people in the channel."
              : `${devFakeParticipants} invented, on top of anyone actually there.`
          }
          value={devFakeParticipants}
          onChange={setDevFakeParticipants}
          min={0}
          max={MAX_FAKE_PARTICIPANTS}
          step={1}
        />

        <SliderSetting
          title="How many are muted"
          description="Checks the muted badge at whatever tile size the grid lands on."
          value={Math.min(devFakeMuted, devFakeParticipants)}
          onChange={setDevFakeMuted}
          min={0}
          max={Math.max(devFakeParticipants, 1)}
          step={1}
        />

        <ToggleSetting
          title="Fake screen share"
          description="Gives the first fake participant a share, backed by an animated canvas rather than a placeholder, so the tile takes the same path a real share does."
          checked={devFakeScreenShare}
          onCheckedChange={setDevFakeScreenShare}
        />
      </SettingGroup>

      <Separator size="4" />

      <Text size="1" color="gray">
        The query string still works and overrides these while it is present:
        <br />
        <code>?fake=6&amp;fakemuted=2&amp;fakeshare=1</code>
      </Text>
    </SettingsContainer>
  );
}
