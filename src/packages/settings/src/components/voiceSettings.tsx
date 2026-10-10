import { Divider } from "@gryt/ui";
import { useState } from "react";

import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";
import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { NoticeDialog } from "../../../socket/src/components/NoticeDialog";
import { SettingGroup, SettingsContainer, SliderSetting, ToggleSetting } from "./settingsComponents";
import { SoundSettings } from "./SoundSettings";
import { TileLayoutPicker } from "./tileLayoutPicker";
import { TwoPersonLayoutPicker } from "./twoPersonLayoutPicker";

export function VoiceSettings() {
  const { t: tr } = useTranslation();
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
    afkTimeoutMinutes,
    setAfkTimeoutMinutes,
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
        {tr("ui.voice")}
      </h2>

      <ToggleSetting anchorId="esports-mode"
        title={tr("ui.esportsMode")}
        description={tr("ui.lowestPossibleLatencyDisablesAllAudioProcessingEnables")}
        checked={eSportsModeEnabled}
        onCheckedChange={setESportsModeEnabled}
        statusText={eSportsModeEnabled
          ? tr("audio.esportsActive")
          : undefined
        }
      />

      <Divider />

      <SliderSetting anchorId="afk-timeout"
        title={tr("audio.afkTimeout", { count: afkTimeoutMinutes })}
        description={tr("ui.youAreMarkedAfkAfterThisManyMinutes")}
        value={afkTimeoutMinutes}
        onChange={setAfkTimeoutMinutes}
        min={1}
        max={30}
      />

      <Divider />

      <div className="flex flex-col gap-4">
        <SoundSettings
          label={tr("ui.connectSound")}
          description={tr("ui.playSoundWhenConnectingToVoice")}
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
          label={tr("ui.disconnectSound")}
          description={tr("ui.playSoundWhenDisconnectingFromVoice")}
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
      <SettingGroup anchorId="tile-layout"
        title={tr("ui.tileLayout")}
        description={tr("ui.howTheVoiceGridArrangesPeopleOnceIt")}
      >
        <TileLayoutPicker value={voiceTileLayout} onChange={setVoiceTileLayout} />


      </SettingGroup>

      <SettingGroup anchorId="two-people"
        title={tr("ui.twoPeople")}
        description={tr("ui.withExactlyTwoOfYouInAChannel")}
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
