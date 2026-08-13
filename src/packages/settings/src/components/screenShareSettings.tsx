
import { useSettings } from "@/settings";

import { SettingsContainer, ToggleSetting } from "./settingsComponents";

/**
 * Screen sharing, which is video.
 *
 * This was filed under Advanced, next to the debug overlays, where nothing
 * about the name told you it changed how capture works.
 */
export function ScreenShareSettings() {
  const { experimentalScreenShare, setExperimentalScreenShare } = useSettings();

  return (
    <SettingsContainer>
      <h2 className="text-lg">
        Screen share
      </h2>

      <ToggleSetting
        title="Experimental screen share"
        description="Unlock high frame rate options (144, 165, 240 FPS) for screen sharing. These require significant bandwidth and may not work on all hardware."
        checked={experimentalScreenShare}
        onCheckedChange={setExperimentalScreenShare}
        statusText={experimentalScreenShare
          ? "High FPS options (144, 165, 240) are available in the screen share picker"
          : undefined
        }
      />
    </SettingsContainer>
  );
}
