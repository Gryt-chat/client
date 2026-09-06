import "./style.css";

import { createGrytTheme, grytThemeToOptions } from "@gryt/ui";
import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";

import {
  dropPluginApiListeners,
  initPluginApi,
  pruneGrants,
  setPluginApiActivitySetter,
  updatePluginApiCapabilities,
  updatePluginApiTheme,
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
import { VoiceProvider } from "@/webRTC";

import { App } from "./App.tsx";
import { BrowserBanner } from "./components/browserBanner";
import { Titlebar } from "./components/titlebar";
import { UpdateAnnouncement } from "./components/updateAnnouncement";
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
  /* While the editor is open the app wears the draft instead of the saved
     theme. It goes through the same `activeTheme` path below, so the CSS
     variables, the native titlebar strip and the plugin API all follow it
     without knowing an editor exists. */
  const { draft: draftTheme } = useThemeEditor();
  const { googleFontsEnabled } = useSettings();
  const shownTheme = draftTheme ?? activeTheme;

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

  /* **The scale goes on the root, not on `.gryt-app`.** Base UI portals every
     dialog, menu, popover and tooltip to document.body, so those are siblings
     of `.gryt-app` rather than descendants — the slider scaled the sidebar and
     the chat and left settings, menus and tooltips alone.

     `--chat-font-size` moves with it, since the autocompletes are popovers.
     Measured at 1440x900, a `fixed inset-0` element is 1440x900 at zoom 1, 1.5
     and 0.75, so the backdrop is safe. */
  useEffect(() => {
    const root = document.documentElement;
    root.style.zoom = String(uiScale);
    root.style.setProperty("--chat-font-size", `${chatFontSize}px`);
  }, [uiScale, chatFontSize]);

  /* An imported theme, painted onto the same element for the same reason: the
     variables have to be somewhere every overlay can read them, and overlays
     portal to document.body.

     Every property is removed before the next set goes on, because a theme is
     not guaranteed to declare what the one before it did — switching from a
     theme with a split light hue set to one without would otherwise leave the
     old light accent behind, on an element nothing else ever cleans. */
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

  /* A face the theme names and this machine has agreed to fetch.
     
     Keyed on the fonts rather than the whole theme, so dragging a colour
     slider does not re-ask Google for the same family on every frame. Nothing
     happens at all unless the setting is on and the theme names something that
     is not already here. */
  const wanted = shownTheme?.fonts;
  useEffect(() => {
    syncGoogleFonts(
      wanted === null || wanted === undefined ? [] : Object.values(wanted),
      googleFontsEnabled,
    );
  }, [wanted, googleFontsEnabled]);

  /* The native minimise/maximise/close buttons on Windows and Linux, which
     the stylesheet cannot reach — they are painted by the OS into an overlay
     strip (GRYT-288).

     After the two effects above rather than before, and deliberately so: this
     reads what the variables evaluate to on the root element, and the effect
     that puts an imported theme there runs in source order. */
  useEffect(() => {
    pushTitlebarOverlay();
  }, [shownTheme, resolvedAppearance]);

  useZoomShortcuts();
  useAddonLoader();
  updatePluginApiTheme({ appearance: resolvedAppearance, accentColor });

  /* What each installed plugin says it needs, so `window.gryt` can check a
     grant against the manifest it was made for (GRYT-928). Refreshed whenever
     the list changes, because an addon updating its manifest is exactly the
     case a stale copy would get wrong. */
  const { addons } = useAddons();
  /* Which ids were installed last time round, so a departure can be spotted.
     `addons` is the current list and says nothing about what left. */
  const listeningRef = useRef<string[]>([]);
  useEffect(() => {
    updatePluginApiCapabilities(addons);
    /* And forget what an addon that is no longer here was allowed to do. An
       id is a folder name, so a grant left behind would be inherited by the
       next addon to use the same one. */
    const installed = addons.map((addon) => addon.id);
    pruneGrants(installed);

    /* Same for what it was listening to (GRYT-939). A plugin that has been
       turned off keeps receiving until its handlers are dropped, and one
       reloaded from a changed file would otherwise have two generations of
       handlers running at once. */
    for (const id of listeningRef.current) {
      if (!installed.includes(id)) dropPluginApiListeners(id);
    }
    listeningRef.current = installed;
  }, [addons]);

  /* The one thing a plugin can currently do. Wired here rather than inside the
     API so `pluginApi.ts` stays free of the socket layer and can be tested
     without one. */
  const { setActivity } = useSettings();
  useEffect(() => {
    setPluginApiActivitySetter(setActivity);
  }, [setActivity]);

  return (
    /* The <Theme> that used to sit here was Radix's, and it existed to define
       --gray-*, --accent-* and --radius-*. Those come from @gryt/ui's
       stylesheet now, which is imported once at the top of this file, so what
       is left is the layout. The zoom and the chat font size it was also
       carrying moved to the root element above, where the overlays can see
       them. */
    <div className="gryt-app flex min-h-0 flex-1 flex-col">
      <Titlebar />
      <BrowserBanner />
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <App />
      </div>
      <UpdateAnnouncement />
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