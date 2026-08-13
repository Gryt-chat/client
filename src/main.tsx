import "@gryt/ui/styles.css";
import "./style.css";

import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";

import { initPluginApi, updatePluginApiTheme, useAddonLoader } from "@/addons";
import { SingletonHooks, useTheme, useZoomShortcuts } from "@/common";

import { App } from "./App.tsx";
import { BrowserBanner } from "./components/browserBanner";
import { Titlebar } from "./components/titlebar";
import { initGlobalStorage } from "./lib/globalStorage";

// eslint-disable-next-line react-refresh/only-export-components
function ThemedApp() {
  const {
    resolvedAppearance,
    accentColor,
    uiScale,
    chatFontSize,
  } = useTheme();

  /* Radix's <Theme appearance> put .light or .dark on its own wrapper, and the
     app's light and dark blocks in style.css hang off those classes. With the
     wrapper gone the class has to go somewhere, and the root element is the
     right place: the overlays portal to document.body, which is outside
     anything else we could put it on. */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedAppearance === "dark");
    root.classList.toggle("light", resolvedAppearance !== "dark");
    root.style.colorScheme = resolvedAppearance;
  }, [resolvedAppearance]);

  useZoomShortcuts();
  useAddonLoader();
  updatePluginApiTheme({ appearance: resolvedAppearance, accentColor });

  return (
    /* The <Theme> that used to sit here was Radix's, and it existed to define
       --gray-*, --accent-* and --radius-*. Those come from @gryt/ui's
       stylesheet now, which is imported once at the top of this file, so what
       is left is the layout and the zoom it was also carrying. */
    <div
      className="gryt-app flex min-h-0 flex-1 flex-col"
      style={{
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
        containerStyle={{ zIndex: "var(--gryt-z-toast)" }}
        toastOptions={{
          style: {
            background: "var(--gryt-neutral-2)",
            color: "var(--gryt-neutral-12)",
            border: "1px solid var(--gryt-neutral-6)",
          },
        }}
      />
    </div>
  );
}

initPluginApi(__APP_VERSION__);

initGlobalStorage().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {/* Runs every singleton hook body, once, inside this tree. Must sit above
          ThemedApp, which consumes several of them. */}
      <SingletonHooks />
      <ThemedApp />
    </React.StrictMode>,
  );
});