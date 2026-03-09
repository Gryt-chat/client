import "@radix-ui/themes/styles.css";
import "./style.css";

import { Theme } from "@radix-ui/themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";

import { initPluginApi, updatePluginApiTheme, useAddonLoader } from "@/addons";
import { useTheme, useZoomShortcuts } from "@/common";

import { App } from "./App.tsx";
import { BrowserBanner } from "./components/browserBanner";
import { Titlebar } from "./components/titlebar";
import { initGlobalStorage } from "./lib/globalStorage";

// eslint-disable-next-line react-refresh/only-export-components
function ThemedApp() {
  const {
    resolvedAppearance,
    accentColor,
    grayColor,
    radius,
    uiScale,
    chatFontSize,
  } = useTheme();

  useZoomShortcuts();
  useAddonLoader();
  updatePluginApiTheme({ appearance: resolvedAppearance, accentColor });

  return (
    <Theme
      appearance={resolvedAppearance}
      accentColor={accentColor}
      grayColor={grayColor}
      radius={radius}
      hasBackground
      panelBackground="solid"
      style={{
        minHeight: 0,
        flex: 1,
        display: "flex",
        flexDirection: "column",
        zoom: uiScale,
        "--chat-font-size": `${chatFontSize}px`,
      } as React.CSSProperties}
    >
      <Titlebar />
      <BrowserBanner />
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <App />
      </div>
      <Toaster
        position="bottom-right"
        containerStyle={{ zIndex: 99999 }}
        toastOptions={{
          style: {
            background: "var(--color-panel-solid)",
            color: "var(--gray-12)",
            border: "1px solid var(--gray-6)",
          },
        }}
      />
    </Theme>
  );
}

initPluginApi(__APP_VERSION__);

initGlobalStorage().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemedApp />
    </React.StrictMode>,
  );
});