import "./style.css";

import { createGrytTheme, grytThemeToOptions } from "@gryt/ui";
import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";

import {
  dropPluginApiListeners,
  pruneGrants,
  setPluginApiActivitySetter,
  setPluginApiRunningPrograms,
  setPluginHostTheme,
  setPluginHostVersion,
  useAddonLoader,
  useAddons,
} from "@/addons";
import {
  backfillGuestHistory,
  migrateLegacyMergeChoice,
  pruneReproducibleKeys,
  SingletonHooks,
  useCustomThemes,
  useTheme,
  useThemeEditor,
  useZoomShortcuts,
} from "@/common";
import { ThemeEditorPanel } from "@/settings";
import { useSettings } from "@/settings";
import { ServerPluginsModal } from "@/socket";
import { VoiceProvider } from "@/webRTC";

import { App } from "./App.tsx";
import { BrowserBanner } from "./components/browserBanner";
import { ServiceStatusBanner } from "./components/serviceStatusBanner";
import { Titlebar } from "./components/titlebar";
import { UpdateAnnouncement } from "./components/updateAnnouncement";
import { WhatsNew } from "./components/whatsNew";
import { initGlobalStorage } from "./lib/globalStorage";
import { syncGoogleFonts } from "./lib/googleFonts";
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
  /* The draft goes through the same `activeTheme` path, so the variables, the
     titlebar strip and the plugin API follow it without knowing. */
  const { draft: draftTheme } = useThemeEditor();
  const { googleFontsEnabled } = useSettings();
  const shownTheme = draftTheme ?? activeTheme;

  /* style.css hangs its light and dark blocks off these classes, and the root is
     where they have to go: overlays portal to document.body. */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedAppearance === "dark");
    root.classList.toggle("light", resolvedAppearance !== "dark");
    root.style.colorScheme = resolvedAppearance;
  }, [resolvedAppearance]);

  /* On the root, not `.gryt-app`: Base UI portals every overlay to document.body,
     so the slider scaled the chat and left menus and tooltips alone. */
  useEffect(() => {
    const root = document.documentElement;
    root.style.zoom = String(uiScale);
    // body sizes itself off this. Viewport units are not divided by a zoom on
    // the root, so without it the window and the layout disagree by the scale.
    root.style.setProperty("--gryt-ui-scale", String(uiScale));
    root.style.setProperty("--chat-font-size", `${chatFontSize}px`);
  }, [uiScale, chatFontSize]);

  /* On the same element, so every overlay can read the variables. Cleared first,
     because a theme need not declare what the one before it did. */
  useEffect(() => {
    const root = document.documentElement;
    if (shownTheme === null) return;

    const variables = createGrytTheme(
      grytThemeToOptions(shownTheme, resolvedAppearance),
    ) as Record<string, string>;

    for (const [name, value] of Object.entries(variables)) {
      root.style.setProperty(name, value);
    }

    return () => {
      for (const name of Object.keys(variables)) {
        root.style.removeProperty(name);
      }
    };
  }, [shownTheme, resolvedAppearance]);

  /* Keyed on the fonts rather than the whole theme, so dragging a colour slider
     does not re-ask Google for the same family every frame. */
  const wanted = shownTheme?.fonts;
  useEffect(() => {
    syncGoogleFonts(
      wanted === null || wanted === undefined ? [] : Object.values(wanted),
      googleFontsEnabled,
    );
  }, [wanted, googleFontsEnabled]);

  /* The OS paints these into an overlay strip the stylesheet cannot reach. After
     the two effects above, since this reads what the variables evaluate to. */
  useEffect(() => {
    pushTitlebarOverlay();
  }, [shownTheme, resolvedAppearance]);

  useZoomShortcuts();
  useAddonLoader();
  setPluginHostTheme({ appearance: resolvedAppearance, accentColor });

  /* A plugin's manifest reaches its worker at startup, so all that is left here
     is forgetting what an addon that has gone was allowed to do. */
  const { addons } = useAddons();
  /* Which ids were installed last time round, so a departure can be spotted.
     `addons` is the current list and says nothing about what left. */
  const listeningRef = useRef<string[]>([]);
  useEffect(() => {
    /* An id is a folder name, so a grant left behind is inherited by the next
       addon to use it. */
    const installed = addons.map((addon) => addon.id);
    pruneGrants(installed);

    /* A plugin turned off keeps receiving until its handlers are dropped, and one
       reloaded would run two generations at once. */
    for (const id of listeningRef.current) {
      if (!installed.includes(id)) dropPluginApiListeners(id);
    }
    listeningRef.current = installed;
  }, [addons]);

  /* Wired here rather than inside the API, so `pluginApi.ts` stays free of the
     socket layer. */
  const { setActivity, playingNow } = useSettings();
  useEffect(() => {
    setPluginApiActivitySetter(setActivity);
  }, [setActivity]);

  /* Wired here for the same reason as the setter above: the host stays free of
     the settings layer. */
  useEffect(() => {
    setPluginApiRunningPrograms(playingNow);
  }, [playingNow]);

  return (
  /* Radix's <Theme> defined the tokens @gryt/ui's stylesheet now carries, so what
     is left here is the layout. */
    <div className="gryt-app flex min-h-0 flex-1 flex-col">
      <Titlebar />
      <ServiceStatusBanner />
      <BrowserBanner />
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <App />
      </div>
      <UpdateAnnouncement />
      <WhatsNew />
      {/* Mounted once rather than per server view, because the two places a
          server menu is drawn — the sidebar and the mobile view — would
          otherwise each need the state and the dialog (GRYT-942). */}
      <ServerPluginsModal />
      {/* Inside .gryt-app so it scales with the rest, and last so it sits over
          it. Not portalled: it is part of the app, not an overlay above it —
          a menu or a dialog opened while it is up should still come out on
          top, because whoever opened one is looking at that and not at this. */}
      <ThemeEditorPanel />
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

setPluginHostVersion(__APP_VERSION__);

/* One pass, and only on an install that predates it. Failing is not worth
   blocking a render for: `hasLocalIdentity` heals each server on its own. */
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