import { Divider } from "@gryt/ui";
import { useState } from "react";

import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";
import { useSettings } from "@/settings";

import { NoticeDialog } from "../../../socket/src/components/NoticeDialog";
import { SettingGroup, SettingsContainer, ToggleSetting } from "./settingsComponents";
import { SoundSettings } from "./SoundSettings";
import { TileLayoutPicker } from "./tileLayoutPicker";
import { TwoPersonLayoutPicker } from "./twoPersonLayoutPicker";

export function VoiceSettings() {
  const {
    eSportsModeEnabled,
    setESportsModeEnabled,
    connectSoundEnabled,
    setConnectSoundEnabled,
    disconnectSoundEnabled,
    setDisconnectSoundEnabled,
    connectSoundVolume,
    setConnectSoundVolume,
    disconnectSoundVolume,
    setDisconnectSoundVolume,
    customConnectSoundFile,
    setCustomConnectSoundFile,
    customDisconnectSoundFile,
    setCustomDisconnectSoundFile,
    voiceTileLayout,
    setVoiceTileLayout,
    voiceTwoPersonLayout,
    setVoiceTwoPersonLayout,
  } = useSettings();

  const [alertDialog, setAlertDialog] = useState<{
    open: boolean;
    type: "success" | "error";
    title: string;
    message: string;
  }>({
    open: false,
    type: "success",
    title: "",
    message: "",
  });

  const showAlert = (
    type: "success" | "error",
    title: string,
    message: string,
  ) => {
    setAlertDialog({ open: true, type, title, message });
  };

  return (
    <SettingsContainer>
      <h2>
        Voice
      </h2>

      <ToggleSetting
        title="eSports mode"
        description="Lowest possible latency. Disables all audio processing, enables push-to-talk, caps bitrate at 128kbps (studio quality), and optimizes Opus packetization (10ms frames)."
        checked={eSportsModeEnabled}
        onCheckedChange={setESportsModeEnabled}
        statusText={eSportsModeEnabled
          ? "Active — RNNoise off, noise gate bypassed, PTT enabled, 128kbps cap, ptime=10ms"
          : undefined
        }
      />

      <Divider />

      <div className="flex flex-col gap-4">
        <SoundSettings
          label="Connect sound"
          description="Play sound when connecting to voice"
          enabled={connectSoundEnabled}
          onEnabledChange={setConnectSoundEnabled}
          volume={connectSoundVolume}
          onVolumeChange={setConnectSoundVolume}
          defaultVolume={10}
          customSoundFile={customConnectSoundFile}
          onCustomSoundFileChange={setCustomConnectSoundFile}
          defaultSoundSrc={connectMp3}
          showAlert={showAlert}
        />
        <SoundSettings
          label="Disconnect sound"
          description="Play sound when disconnecting from voice"
          enabled={disconnectSoundEnabled}
          onEnabledChange={setDisconnectSoundEnabled}
          volume={disconnectSoundVolume}
          onVolumeChange={setDisconnectSoundVolume}
          defaultVolume={10}
          customSoundFile={customDisconnectSoundFile}
          onCustomSoundFileChange={setCustomDisconnectSoundFile}
          defaultSoundSrc={disconnectMp3}
          showAlert={showAlert}
        />
      </div>


      <NoticeDialog
        open={alertDialog.open}
        onClose={() => setAlertDialog({ ...alertDialog, open: false })}
        title={alertDialog.title}
        message={alertDialog.message}
      />
      <SettingGroup
        title="Tile layout"
        description="How the voice grid arranges people once it is maximised or fullscreen. Both were measured against Google Meet; which you prefer is a matter of taste. The sidebar looks the same either way."
      >
        <TileLayoutPicker value={voiceTileLayout} onChange={setVoiceTileLayout} />


      </SettingGroup>

      <SettingGroup
        title="Two people"
        description="With exactly two of you in a channel and nobody sharing a screen. One large and one small is what a video call usually does; same size is better when you are both doing something rather than talking to each other."
      >
        <TwoPersonLayoutPicker
          value={voiceTwoPersonLayout}
          onChange={setVoiceTwoPersonLayout}
          rule={voiceTileLayout}
        />
      </SettingGroup>
    </SettingsContainer>
  );
}
