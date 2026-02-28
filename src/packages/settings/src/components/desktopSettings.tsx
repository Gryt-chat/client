import { Heading, Separator } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";

import { getElectronAPI } from "../../../../lib/electron";
import { SettingsContainer, ToggleSetting } from "./settingsComponents";

export function DesktopSettings() {
  const [closeToTray, setCloseToTray] = useState(true);
  const [startWithWindowsSupported, setStartWithWindowsSupported] = useState(false);
  const [startWithWindows, setStartWithWindows] = useState(true);
  const [startMinimizedOnLogin, setStartMinimizedOnLogin] = useState(false);

  useEffect(() => {
    getElectronAPI()?.getCloseToTray().then(setCloseToTray);
  }, []);

  useEffect(() => {
    getElectronAPI()?.getStartWithWindowsSupported().then((supported) => {
      setStartWithWindowsSupported(supported);
      if (!supported) return;
      getElectronAPI()?.getStartWithWindows().then(setStartWithWindows);
    });
  }, []);

  useEffect(() => {
    getElectronAPI()?.getStartMinimizedOnLogin().then(setStartMinimizedOnLogin);
  }, []);

  const handleCloseToTrayToggle = useCallback((enabled: boolean) => {
    setCloseToTray(enabled);
    getElectronAPI()?.setCloseToTray(enabled);
  }, []);

  const handleStartWithWindowsToggle = useCallback((enabled: boolean) => {
    setStartWithWindows(enabled);
    getElectronAPI()?.setStartWithWindows(enabled);
  }, []);

  const handleStartMinimizedOnLoginToggle = useCallback((enabled: boolean) => {
    setStartMinimizedOnLogin(enabled);
    getElectronAPI()?.setStartMinimizedOnLogin(enabled);
  }, []);

  return (
    <SettingsContainer>
      <Heading as="h2" size="4">
        Desktop
      </Heading>

      {startWithWindowsSupported && (
        <>
          <ToggleSetting
            title="Start with Windows"
            description="Automatically launch Gryt when you sign in to Windows."
            checked={startWithWindows}
            onCheckedChange={handleStartWithWindowsToggle}
          />
          {startWithWindows && (
            <>
              <Separator size="4" />
              <ToggleSetting
                title="Start minimized on login"
                description="Only applies when Gryt is launched automatically on sign-in. Manual launches will still show the window."
                checked={startMinimizedOnLogin}
                onCheckedChange={handleStartMinimizedOnLoginToggle}
              />
            </>
          )}
          <Separator size="4" />
        </>
      )}

      <ToggleSetting
        title="Minimize to Tray on Close"
        description="When enabled, closing the window minimizes to the system tray instead of quitting the app."
        checked={closeToTray}
        onCheckedChange={handleCloseToTrayToggle}
      />
    </SettingsContainer>
  );
}
