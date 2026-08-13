import { Divider } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { getElectronAPI } from "../../../../lib/electron";
import { SettingsContainer, ToggleSetting } from "./settingsComponents";

export function DesktopSettings() {
  const [closeToTray, setCloseToTray] = useState(true);
  const [startWithWindowsSupported, setStartWithWindowsSupported] = useState(false);
  const [startWithWindows, setStartWithWindows] = useState(true);
  const [startMinimizedOnLogin, setStartMinimizedOnLogin] = useState(false);
  const [hwAccel, setHwAccel] = useState(true);

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

  useEffect(() => {
    getElectronAPI()?.getHardwareAcceleration().then(setHwAccel);
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

  const handleHwAccelToggle = useCallback((enabled: boolean) => {
    setHwAccel(enabled);
    getElectronAPI()?.setHardwareAcceleration(enabled);
  }, []);

  return (
    <SettingsContainer>
      <h2>
        Desktop
      </h2>

      {startWithWindowsSupported && (
        <>
          <ToggleSetting
            title="Start with Windows"
            description="Launches Gryt when you sign in to Windows."
            checked={startWithWindows}
            onCheckedChange={handleStartWithWindowsToggle}
          />
          {startWithWindows && (
            <>
              <Divider />
              <ToggleSetting
                title="Start minimized on login"
                description="Only applies when Gryt is launched automatically on sign-in. Manual launches will still show the window."
                checked={startMinimizedOnLogin}
                onCheckedChange={handleStartMinimizedOnLoginToggle}
              />
            </>
          )}
          <Divider />
        </>
      )}

      <ToggleSetting
        title="Minimize to tray on close"
        description="Closing the window hides Gryt in the system tray instead of quitting it."
        checked={closeToTray}
        onCheckedChange={handleCloseToTrayToggle}
      />

      <Divider />

      <ToggleSetting
        title="Hardware acceleration"
        description="Uses your GPU for rendering. Turn it off if you see visual glitches or high GPU usage. Changing this restarts Gryt."
        checked={hwAccel}
        onCheckedChange={handleHwAccelToggle}
      />
    </SettingsContainer>
  );
}
