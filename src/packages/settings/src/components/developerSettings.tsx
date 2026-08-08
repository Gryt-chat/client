import { Badge, Flex, Heading, Separator, Text } from "@radix-ui/themes";

import { useSettings } from "@/settings";

import {
  SettingGroup,
  SettingsContainer,
  SliderSetting,
  ToggleSetting,
} from "./settingsComponents";

/**
 * Names are assigned in order and the two groups do not share any, so these
 * bound the sliders. They mirror the constants in fakeParticipants.ts.
 */
const MAX_FAKE_PARTICIPANTS = 12;
const MAX_FAKE_MEMBERS = 12;

/**
 * Developer tools. Rendered only under `import.meta.env.DEV`, which Vite
 * constant-folds to false in a production build, so the whole panel and its
 * tab disappear from a release.
 */
export function DeveloperSettings() {
  const {
    devFakeParticipants,
    setDevFakeParticipants,
    devFakeMembers,
    setDevFakeMembers,
    devFakeMuted,
    setDevFakeMuted,
    devFakeScreenShare,
    setDevFakeScreenShare,
    devFakeDeafened,
    setDevFakeDeafened,
    devFakeSpeaking,
    setDevFakeSpeaking,
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
        description="Invents people in the voice channel you are in and in the member list around it, so both can be seen at counts a single account cannot reach — the server allows one voice connection per user, so a second tab gets kicked. They render through the real voice view and the real member list, so this proves layout and nothing about the socket path."
      >
        <SliderSetting
          title="In the voice channel with you"
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
          title="In the server, not in voice"
          description={
            devFakeMembers === 0
              ? "Off — the member list shows only the people in the call."
              : `${devFakeMembers} more in the member list, spread across online, AFK and offline.`
          }
          value={devFakeMembers}
          onChange={setDevFakeMembers}
          min={0}
          max={MAX_FAKE_MEMBERS}
          step={1}
        />

        <SliderSetting
          title="How many are muted"
          description="Of the people in voice. Muted and deafened ones stay silent — nothing talks that should not be able to."
          value={Math.min(devFakeMuted, devFakeParticipants)}
          onChange={setDevFakeMuted}
          min={0}
          max={Math.max(devFakeParticipants, 1)}
          step={1}
        />

        <ToggleSetting
          title="One is deafened"
          description="Deafens the last one, and mutes them with it, since that is what deafening does here. The deafened badge is a different icon from the muted one."
          checked={devFakeDeafened}
          onCheckedChange={setDevFakeDeafened}
        />

        <ToggleSetting
          title="They talk"
          description="Everyone not muted takes turns talking, in bursts of a few seconds with longer gaps. Each one gets a real silent audio track, so the halo and the speaking ring are driven by a level the same way a real participant's are."
          checked={devFakeSpeaking}
          onCheckedChange={setDevFakeSpeaking}
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
        <code>
          ?fake=6&amp;fakemembers=8&amp;fakemuted=2&amp;fakeshare=1&amp;fakedeaf=1&amp;fakespeak=0
        </code>
      </Text>
    </SettingsContainer>
  );
}
