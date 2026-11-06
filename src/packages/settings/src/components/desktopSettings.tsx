import { Divider } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { getElectronAPI, isMacDesktop } from "../../../../lib/electron";
import { useLocale } from "../../../../lib/localeContext";
import { SettingsContainer, ToggleSetting } from "./settingsComponents";

const isMac = isMacDesktop();

export function DesktopSettings() {
  const { t } = useLocale();
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
        {t("settings.desktop.label")}
      </h2>

      {startWithWindowsSupported && (
        <>
          {isMac ? (
            <ToggleSetting
              title="Open at login" titleKey="settings.openAtLogin"
              description={t("settings.opensGrytWhenYouLogInToYourMac")}
              checked={startWithWindows}
              onCheckedChange={handleStartWithWindowsToggle}
            />
          ) : (
            <ToggleSetting
              title="Start with Windows" titleKey="settings.startWithWindows"
              description={t("settings.launchesGrytWhenYouSignInToWindows")}
              checked={startWithWindows}
              onCheckedChange={handleStartWithWindowsToggle}
            />
          )}
          {/* macOS can't reliably tell an app it was opened at login, so there's nothing to start minimized on. */}
          {startWithWindows && !isMac && (
            <>
              <Divider />
              <ToggleSetting
                title="Start minimized on login" titleKey="settings.startMinimizedOnLogin"
                description={t("settings.onlyAppliesWhenGrytIsLaunchedAutomaticallyOnSignIn")}
                checked={startMinimizedOnLogin}
                onCheckedChange={handleStartMinimizedOnLoginToggle}
              />
            </>
          )}
          <Divider />
        </>
      )}

      <ToggleSetting
        title="Minimize to tray on close" titleKey="settings.minimizeToTrayOnClose"
        description={t("settings.closingTheWindowHidesGrytInTheSystemTrayInstead")}
        checked={closeToTray}
        onCheckedChange={handleCloseToTrayToggle}
      />

      <Divider />

      <ToggleSetting
        title="Hardware acceleration" titleKey="settings.desktop.hardwareAcceleration"
        description={t("settings.usesYourGpuForRenderingTurnItOffIfYou")}
        checked={hwAccel}
        onCheckedChange={handleHwAccelToggle}
      />
    </SettingsContainer>
  );
}
