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

  /* The scale, on the root for the same reason the appearance class is.
     
     It used to sit on .gryt-app below, which is the element wrapping the
     titlebar, the app and the toaster — and nothing else. Base UI portals
     every dialog, menu, popover, tooltip and drawer to document.body, so a
     portal node is a sibling of .gryt-app rather than a descendant of it, and
     zoom inherits down the tree. The slider and Ctrl+plus scaled the sidebar,
     the chat and the member list, and did not touch the owl designer,
     settings, the emoji picker, any menu or any tooltip. Turned up for a big
     screen, the app came apart into two sizes.

     --chat-font-size moves with it: EmojiAutocomplete and MentionAutocomplete
     read it and are popovers, so they had been falling back to 16px whatever
     the reader had chosen.

     zoom on the root is safe for the backdrop, which is the thing to check —
     a `fixed inset-0` element under a zoomed ancestor could have covered the
     wrong box. Measured at 1440x900: the backdrop is 1440x900 at zoom 1, 1.5
     and 0.75, and the popup scales. */
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