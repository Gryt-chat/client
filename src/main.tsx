import "@gryt/ui/styles.css";
import "./style.css";

import { createGrytTheme, grytThemeToOptions } from "@gryt/ui";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";

import { initPluginApi, updatePluginApiTheme, useAddonLoader } from "@/addons";
import {
  backfillGuestHistory,
  migrateLegacyMergeChoice,
  pruneReproducibleKeys,
  SingletonHooks,
  useCustomThemes,
  useTheme,
  useZoomShortcuts,
} from "@/common";
import { VoiceProvider } from "@/webRTC";

import { App } from "./App.tsx";
import { BrowserBanner } from "./components/browserBanner";
import { Titlebar } from "./components/titlebar";
import { UpdateAnnouncement } from "./components/updateAnnouncement";
import { initGlobalStorage } from "./lib/globalStorage";
import { captureLogs } from "./lib/reports/logs";
import { pushTitlebarOverlay } from "./lib/titlebarOverlay";

// eslint-disable-next-line react-refresh/only-export-components
function ThemedApp() {
  const {
    resolvedAppearance,
    accentColor,
    uiScale,
    chatFontSize,
  } = useTheme();
  const { activeTheme } = useCustomThemes();

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

  /* An imported theme, painted onto the same element for the same reason: the
     variables have to be somewhere every overlay can read them, and overlays
     portal to document.body.

     Every property is removed before the next set goes on, because a theme is
     not guaranteed to declare what the one before it did — switching from a
     theme with a split light hue set to one without would otherwise leave the
     old light accent behind, on an element nothing else ever cleans. */
  useEffect(() => {
    const root = document.documentElement;
    if (activeTheme === null) return;

    const variables = createGrytTheme(
      grytThemeToOptions(activeTheme, resolvedAppearance),
    ) as Record<string, string>;

    for (const [name, value] of Object.entries(variables)) {
      root.style.setProperty(name, value);
    }

    return () => {
      for (const name of Object.keys(variables)) {
        root.style.removeProperty(name);
      }
    };
  }, [activeTheme, resolvedAppearance]);

  /* The native minimise/maximise/close buttons on Windows and Linux, which
     the stylesheet cannot reach — they are painted by the OS into an overlay
     strip (GRYT-288).

     After the two effects above rather than before, and deliberately so: this
     reads what the variables evaluate to on the root element, and the effect
     that puts an imported theme there runs in source order. */
  useEffect(() => {
    pushTitlebarOverlay();
  }, [activeTheme, resolvedAppearance]);

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
      <UpdateAnnouncement />
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

/* Before anything else runs, so a warning during startup is still in the
   buffer when somebody files a report about it twenty minutes later. */
captureLogs();

initPluginApi(__APP_VERSION__);

/* One pass to teach the guest history what the stored keys already know
   (GRYT-285). Only does anything on an install that predates it, and failing is
   not worth blocking a render for — `hasLocalIdentity` heals each server on its
   own the first time it is asked. */
void backfillGuestHistory()
  .then(migrateLegacyMergeChoice)
  .then(pruneReproducibleKeys);

initGlobalStorage().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {/* Runs every singleton hook body, once, inside this tree. Must sit above
          ThemedApp, which consumes several of them. */}
      <SingletonHooks />
      {/* Supplies @gryt/voice with the settings, the connection target and the
          Electron host, and runs that package's singleton hooks — which are a
          separate registry from the one above. Sits below <SingletonHooks />
          because it reads useSockets and useServerManagement, which are the
          client's own singletons. */}
      <VoiceProvider>
        <ThemedApp />
      </VoiceProvider>
    </React.StrictMode>,
  );
});