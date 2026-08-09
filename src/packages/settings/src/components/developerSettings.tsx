import { Badge, Button, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { PiPlayFill, PiStopFill } from "react-icons/pi";

import { useSettings } from "@/settings";
import {
  setFakeChatRunning,
  useFakeChatRunning,
} from "@/socket/src/dev/fakeChatController";

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
    devFakeChatSeconds,
    setDevFakeChatSeconds,
    devFakeMuted,
    setDevFakeMuted,
    devFakeScreenShare,
    setDevFakeScreenShare,
    devFakeDeafened,
    setDevFakeDeafened,
    devFakeSpeaking,
    setDevFakeSpeaking,
  } = useSettings();
  const chatRunning = useFakeChatRunning();

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

      <SettingGroup
        title="Fake chat"
        description="Posts messages from the invented people into the channel you are looking at — mentions, custom emoji, links with previews, code blocks, replies and a wall of text, so each one can be seen rendered. Delivered through the same handler a real message arrives on, so unread badges and the message sound behave normally. Nothing is sent to the server: nobody else sees any of it and none of it is saved."
      >
        <SliderSetting
          title="A message every"
          description={`${devFakeChatSeconds} second${devFakeChatSeconds === 1 ? "" : "s"}, while it is running.`}
          value={devFakeChatSeconds}
          onChange={setDevFakeChatSeconds}
          min={1}
          max={30}
          step={1}
        />

        <Flex direction="column" gap="2">
          <Button
            size="2"
            color={chatRunning ? "red" : undefined}
            variant={chatRunning ? "soft" : "solid"}
            onClick={() => setFakeChatRunning(!chatRunning)}
          >
            {chatRunning ? <PiStopFill size={16} /> : <PiPlayFill size={16} />}
            {chatRunning ? "Stop" : "Start"}
          </Button>
          <Text size="1" color="gray">
            {chatRunning
              ? "Running. It keeps going until you stop it or quit — nothing turns it off on its own."
              : "The message sound only plays when the window is not focused, which is what a real message does too. Click away from Gryt to hear it."}
          </Text>
        </Flex>
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
