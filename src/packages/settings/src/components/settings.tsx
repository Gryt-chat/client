import { Dialog, Divider, IconButton, TextField } from "@gryt/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PiArrowFatLineDownFill, PiFadersHorizontalFill, PiFlaskFill, PiGearSixFill, PiHardDrivesFill, PiHeartFill, PiMagnifyingGlassFill, PiPuzzlePieceFill, PiUserCircleFill, PiUserFill, PiVideoCameraFill, PiX } from "react-icons/pi";

import { useSettings } from "@/settings";

import { isElectron } from "../../../../lib/electron";
import type { SettingsIndexEntry } from "../hooks/settingsSearch";
import { searchSettings } from "../hooks/settingsSearch";
import { AboutSettings, UpdatesSettings } from "./aboutSettings";
import { AccountSettings } from "./accountSettings";
import { AddonsSettings } from "./addonsSettings";
import { AdvancedSettings } from "./advancedSettings";
import { AudioSettings } from "./audioSettings";
import { CameraSettings } from "./cameraSettings";
import { ChatSettings } from "./chatSettings";
import { DesktopSettings } from "./desktopSettings";
import { DeveloperSettings } from "./developerSettings";
import { HotkeySettings } from "./hotkeySettings";
import { MyServersSettings } from "./myServersSettings";
import { NotificationSettings } from "./notificationSettings";
import { PresenceSettings } from "./presenceSettings";
import { ProfileSettings } from "./profileSettings";
import { ScreenShareSettings } from "./screenShareSettings";
import { SecuritySettings } from "./securitySettings";
import { ServerIdentitySettings } from "./serverIdentitySettings";
import { SupportSettings } from "./supportSettings";
import { AppearanceSettings } from "./theme/appearanceSettings";
import { VoiceSettings } from "./voiceSettings";

/**
 * Divider between the former tabs now sharing a destination.
 *
 * Deliberately no heading: every panel already renders its own, so adding one
 * here produced "Profile / Profile". The panel owns its title — this only
 * supplies the separation that used to come from being on different tabs.
 */
function PanelDivider() {
  return <Divider className="my-5" />;
}

/**
 * Five destinations named for what you are trying to do rather than which
 * subsystem owns the setting. Replaces fourteen flat tabs, two of which held a
 * single control each and three of which covered the same mental model.
 *
 * `mountWhenActive` panels touch hardware — microphone analysers, camera
 * preview — so they mount only while their destination is open, preserving the
 * old `conditional` behaviour.
 */
const DESTINATIONS = [
  {
    value: "you",
    label: "You",
    icon: PiUserFill,
    content: (
      <>
        <ProfileSettings />
        <PanelDivider />
        <SecuritySettings />
        <PanelDivider />
        <ServerIdentitySettings />
      </>
    ),
  },
  {
    value: "account",
    label: "Account",
    icon: PiUserCircleFill,
    content: <AccountSettings />,
  },
  // Electron only, because the embedded server is. In a browser this would be
  // a destination that can never have anything in it.
  ...(isElectron()
    ? [
        {
          value: "my-servers",
          label: "My servers",
          icon: PiHardDrivesFill,
          content: <MyServersSettings />,
        },
      ]
    : []),
  {
    value: "sound-video",
    label: "Sound & video",
    icon: PiVideoCameraFill,
    mountWhenActive: true,
    content: (
      <>
        <AudioSettings />
        <PanelDivider />
        <VoiceSettings />
        <PanelDivider />
        <CameraSettings />
        <PanelDivider />
        <ScreenShareSettings />
      </>
    ),
  },
  {
    value: "looks",
    label: "How Gryt looks",
    icon: PiGearSixFill,
    content: (
      <>
        <AppearanceSettings />
        <PanelDivider />
        <ChatSettings />
      </>
    ),
  },
  {
    value: "behaviour",
    label: "How Gryt behaves",
    icon: PiFadersHorizontalFill,
    content: (
      <>
        <HotkeySettings />
        <PanelDivider />
        <PresenceSettings />
        <PanelDivider />
        <NotificationSettings />
        {isElectron() && (
          <>
            <PanelDivider />
            <DesktopSettings />
          </>
        )}
        <PanelDivider />
        <AdvancedSettings />
      </>
    ),
  },
  // Dev builds only. `import.meta.env.DEV` folds to false in a release, so
  // both the tab and the panel drop out of the bundle.
  ...(import.meta.env.DEV
    ? [
        {
          value: "developer",
          label: "Developer",
          icon: PiFlaskFill,
          content: <DeveloperSettings />,
        },
      ]
    : []),
  {
    value: "extensions",
    // "Addons" everywhere else — the panel heading, the "Open Addons Folder"
    // button, the useAddons hook, and the addon.json each one ships. The nav
    // was the only place calling them extensions, so it is the one that moves.
    // The tab's `value` stays "extensions" because it is persisted in settings
    // and deep-linked to; renaming it would strand anyone mid-session.
    label: "Addons",
    icon: PiPuzzlePieceFill,
    content: <AddonsSettings />,
  },
  {
    value: "updates",
    label: "Updates & about",
    icon: PiArrowFatLineDownFill,
    content: (
      <>
        <UpdatesSettings />
        <PanelDivider />
        <AboutSettings />
      </>
    ),
  },
  {
    value: "support",
    label: "Support Gryt",
    icon: PiHeartFill,
    // Pinned to the bottom, below a spacer. It is not a setting, and burying a
    // donation link inside "Extensions & about" made it findable only by
    // accident.
    pinBottom: true,
    content: <SupportSettings />,
  },
];

const MAIN_DESTINATIONS = DESTINATIONS.filter((d) => !d.pinBottom);
const PINNED_DESTINATIONS = DESTINATIONS.filter((d) => d.pinBottom);

const DEFAULT_DESTINATION = "you";

/** How long a jumped-to setting stays highlighted. */
const HIGHLIGHT_MS = 1600;

export function Settings() {
  const {
    setLoopbackEnabled,
    setShowSettings,
    showSettings,
    settingsTab,
    setSettingsTab,
  } = useSettings();

  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // Bumped on every jump. The scroll effect keys off this rather than the
  // destination alone, so clicking a second result inside the destination you
  // are already on still scrolls and highlights.
  const [jump, setJump] = useState(0);
  const pendingScroll = useRef<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchSettings(query), [query]);
  const searching = query.trim().length > 0;

  // Every persisted value is an old tab name and none survive the rename, so
  // anything unrecognised falls back instead of rendering an empty panel.
  const active = DESTINATIONS.some((d) => d.value === settingsTab)
    ? settingsTab
    : DEFAULT_DESTINATION;

  const changeDestination = useCallback(
    (value: string) => {
      setLoopbackEnabled(false);
      setSettingsTab(value);
    },
    [setLoopbackEnabled, setSettingsTab],
  );

  function handleDialogChange(isOpen: boolean) {
    setShowSettings(isOpen);
    setLoopbackEnabled(false);
    if (!isOpen) setQuery("");
  }

  const jumpTo = useCallback(
    (entry: SettingsIndexEntry) => {
      // Panels have no anchor of their own — landing on the panel is the result.
      pendingScroll.current = entry.panel ? null : entry.id;
      setPicked(entry.id);
      setJump((n) => n + 1);
      changeDestination(entry.destination);
      // The query deliberately survives. Results stay put so you can click
      // through several candidates to find the one you meant, rather than
      // retyping the search after every guess.
    },
    [changeDestination],
  );

  // Runs after the destination has rendered, since neither the scroll target
  // nor the new content exists in the DOM until then.
  useEffect(() => {
    const id = pendingScroll.current;
    pendingScroll.current = null;

    // Switching destination normally starts you at the top. Without this the
    // new panel inherits the previous one's scroll position and opens partway
    // down, which reads as a rendering glitch.
    if (!id) {
      contentRef.current?.scrollTo({ top: 0 });
      return;
    }

    // Re-highlighting the same setting needs the class removed first, or the
    // animation does not restart.
    setHighlighted(null);

    const frame = requestAnimationFrame(() => {
      const el = contentRef.current?.querySelector<HTMLElement>(
        `[data-setting="${id}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlighted(id);
    });

    return () => cancelAnimationFrame(frame);
  }, [active, jump]);

  useEffect(() => {
    if (!highlighted) return;
    const timer = window.setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlighted]);

  useEffect(() => {
    if (!highlighted || !contentRef.current) return;
    const el = contentRef.current.querySelector<HTMLElement>(
      `[data-setting="${highlighted}"]`,
    );
    if (!el) return;
    el.classList.add("gryt-setting-hit");
    return () => el.classList.remove("gryt-setting-hit");
  }, [highlighted]);

  return (
    <Dialog.Root
      open={showSettings}
      /* The tour lives in a portal of its own, so pressing Next on a coach mark
         counts as a press outside this dialog and used to dismiss it. The panel
         closed on every step change and the next step opened it again, which
         read as the whole thing flickering shut and back for no reason. The
         tour is not outside in any sense the user cares about.

         Radix took an onInteractOutside handler that could preventDefault. Base
         UI routes every open change through one callback with the reason and a
         cancel() on it, so the same exception is a check on the reason. */
      onOpenChange={(open, details) => {
        if (!open && details.reason === "outside-press") {
          const target = details.event?.target as HTMLElement | null;
          if (target?.closest?.('[data-gryt="tour"]')) {
            details.cancel();
            return;
          }
        }
        handleDialogChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup
          data-gryt="settings"
          className="max-w-225"
          style={{ height: "700px", minWidth: "600px" }}
        >
        <Dialog.Close style={{ position: "absolute", top: "8px", right: "8px" }}>
          <IconButton data-tour="settings-close">
            <PiX size={16} />
          </IconButton>
        </Dialog.Close>

        <style>{`
          [data-setting].gryt-setting-hit {
            animation: gryt-setting-hit ${HIGHLIGHT_MS}ms ease-out;
            border-radius: var(--radius-3);
          }
          @keyframes gryt-setting-hit {
            0%, 55% {
              background-color: var(--accent-a4);
              box-shadow: 0 0 0 8px var(--accent-a4);
            }
            100% {
              background-color: transparent;
              box-shadow: 0 0 0 8px transparent;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            [data-setting].gryt-setting-hit {
              animation: none;
              outline: 2px solid var(--accent-9);
              outline-offset: 5px;
            }
          }
        `}</style>

        <div className="flex flex-col gap-4 h-full">
          <Dialog.Title>
            Settings
          </Dialog.Title>

          {showSettings && (
            <div className="flex gap-4 h-full" style={{ flex: 1, minHeight: 0 }}>
              <div style={{
                  width: "220px",
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  minHeight: 0,
                }}>
                {/* The library's TextField has no slot API — it is a field,
                    not a container. The icons sit over it instead, with padding
                    making room for them, which is what Radix's slots were doing
                    behind their own markup anyway. */}
                <div className="relative">
                  <PiMagnifyingGlassFill
                    className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gryt-muted"
                    size={15}
                  />
                  <TextField
                    className="px-10"
                    placeholder="Search settings"
                    value={query}
                    onChange={(e) => setQuery(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      // Clear the query first; only close the dialog once the
                      // search is already empty.
                      if (e.key === "Escape" && query) {
                        e.stopPropagation();
                        setQuery("");
                      }
                      if (e.key === "Enter" && results.length > 0) {
                        jumpTo(results[0]);
                      }
                    }}
                  />
                  {query && (
                    <IconButton
                      aria-label="Clear search"
                      className="absolute top-1/2 right-2 -translate-y-1/2"
                      size="small"
                      onClick={() => {
                        setQuery("");
                        setPicked(null);
                      }}
                    >
                      <PiX size={14} />
                    </IconButton>
                  )}
                </div>

                <div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
                  {searching ? (
                    <SearchResults results={results} onPick={jumpTo} picked={picked} />
                  ) : (
                    <div className="flex flex-col gap-1 h-full">
                      {MAIN_DESTINATIONS.map(({ value, label, icon: Icon }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => changeDestination(value)}
                          className="gryt-settings-nav"
                          data-tour={`settings-${value}`}
                          data-active={value === active}
                        >
                          <Icon size={16} />
                          {label}
                        </button>
                      ))}

                      <div style={{ flex: 1, minHeight: "12px" }} />

                      {PINNED_DESTINATIONS.map(({ value, label, icon: Icon }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => changeDestination(value)}
                          className="gryt-settings-nav gryt-settings-nav-cta"
                          data-active={value === active}
                        >
                          <Icon size={16} />
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div ref={contentRef} style={{
                  flex: 1,
                  overflowY: "auto",
                  overflowX: "hidden",
                  minWidth: 0,
                }}>
                {DESTINATIONS.map(({ value, content, mountWhenActive }) => (
                  <div key={value} hidden={value !== active}>
                    {mountWhenActive ? value === active && content : content}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <style>{`
          .gryt-settings-nav {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            text-align: left;
            font: inherit;
            font-size: var(--font-size-2);
            padding: 8px 10px;
            border-radius: var(--radius-3);
            border: 0;
            cursor: pointer;
            background: transparent;
            color: var(--gray-12);
          }
          .gryt-settings-nav:hover { background: var(--gray-a3); }
          .gryt-settings-nav[data-active="true"] {
            background: var(--accent-a3);
            color: var(--accent-11);
          }
          /* Just the heart carries the colour. A filled button competes with
             the active-item highlight and shouts in a settings sidebar; a red
             heart against grey labels catches the eye on its own. */
          .gryt-settings-nav-cta svg { color: var(--red-9); }
          .gryt-settings-nav-cta:hover svg { color: var(--red-10); }
          .gryt-settings-result {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 1px;
            width: 100%;
            text-align: left;
            font: inherit;
            padding: 7px 10px;
            border-radius: var(--radius-3);
            border: 0;
            cursor: pointer;
            background: transparent;
          }
          .gryt-settings-result:hover { background: var(--gray-a3); }
          .gryt-settings-result[data-picked="true"] {
            background: var(--accent-a3);
            color: var(--accent-11);
          }
        `}</style>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SearchResults({
  results,
  onPick,
  picked,
}: {
  results: SettingsIndexEntry[];
  onPick: (entry: SettingsIndexEntry) => void;
  picked: string | null;
}) {
  if (results.length === 0) {
    return (
      <span className="text-gryt-muted" style={{ padding: "8px 10px", display: "block" }}>
        Nothing matches. Try the name of the control, or a word from its
        description.
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {results.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onPick(entry)}
          className="gryt-settings-result"
          data-picked={entry.id === picked}
        >
          <span>{entry.title}</span>
          <span className="text-gryt-muted">{entry.section}</span>
        </button>
      ))}
    </div>
  );
}
