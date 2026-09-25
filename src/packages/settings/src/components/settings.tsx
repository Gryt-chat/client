import { Dialog, IconButton, TextField } from "@gryt/ui";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSettings } from "@/settings";

import { isElectron } from "../../../../lib/electron";
import { PiChatsFill, PiFadersHorizontalFill, PiFlaskFill, PiHardDrivesFill, PiHeartFill, PiInfoFill, PiMagnifyingGlassFill, PiMicrophoneFill, PiPaletteFill, PiPuzzlePieceFill, PiShieldCheckFill, PiUserFill, PiX } from "../../../../lib/icons";
import { SettingsPicker } from "../../../socket/src/components/SettingsPicker";
import { useRoomForSettingsRail } from "../../../socket/src/hooks/useNarrowWindow";
import { USER_SETTINGS_CHROME } from "../../../socket/src/lib/narrowLayout";
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
import { PrivacySettings } from "./privacySettings";
import { ProfileSettings } from "./profileSettings";
import { ScreenShareSettings } from "./screenShareSettings";
import { SecuritySettings } from "./securitySettings";
import { ServerIdentitySettings } from "./serverIdentitySettings";
import { ServerPreferencesSettings } from "./serverPreferencesSettings";
import { HIGHLIGHT_MS } from "./settingsComponents";
import { SupportSettings } from "./supportSettings";
import { ThemeSettings } from "./theme/appearanceSettings";
import { DisplaySettings } from "./theme/displaySettings";
import { VoiceSettings } from "./voiceSettings";

/** Settings are grouped by the thing somebody is trying to configure. */

/**
 * A destination with `pages` is a category: the rail nests them and the pane shows
 * one. `mountWhenActive` panels hold hardware or revealed addresses, so they mount only in view.
 */
interface SettingsPage {
  value: string;
  label: string;
  content: ReactNode;
  /** Mount only while you are on it. Leaving drops what it holds: a device, a revealed address. */
  mountWhenActive?: boolean;
}

interface SettingsDestination {
  value: string;
  label: string;
  icon: typeof PiUserFill;
  /** A category shows one of these at a time. Without them it is one page. */
  pages?: SettingsPage[];
  content?: ReactNode;
  pinBottom?: boolean;
}

const DESTINATIONS: SettingsDestination[] = [
  {
    value: "profile",
    label: "Profile",
    icon: PiUserFill,
    content: <ProfileSettings />,
  },
  {
    value: "account",
    label: "Account & security",
    icon: PiShieldCheckFill,
    pages: [
      { value: "account", label: "Account", content: <AccountSettings /> },
      { value: "security", label: "Security", content: <SecuritySettings /> },
      { value: "privacy", label: "Privacy", content: <PrivacySettings /> },
    ],
  },
  {
    value: "servers",
    label: "Servers",
    icon: PiHardDrivesFill,
    pages: [
      ...(isElectron()
        ? [{ value: "my-servers", label: "My servers", content: <MyServersSettings /> }]
        : []),
      {
        value: "adding-servers",
        label: "Adding servers",
        content: <ServerPreferencesSettings />,
      },
      {
        value: "identities",
        label: "Server identities",
        content: <ServerIdentitySettings />,
      },
    ],
  },
  {
    value: "chat-notifications",
    label: "Chat & notifications",
    icon: PiChatsFill,
    pages: [
      { value: "chat", label: "Chat", content: <ChatSettings /> },
      {
        value: "notifications",
        label: "Notifications",
        content: <NotificationSettings />,
      },
    ],
  },
  {
    value: "sound-video",
    label: "Voice & video",
    icon: PiMicrophoneFill,
    pages: [
      {
        value: "audio",
        label: "Audio",
        mountWhenActive: true,
        content: <AudioSettings />,
      },
      { value: "voice", label: "Voice", content: <VoiceSettings /> },
      {
        value: "camera",
        label: "Camera",
        mountWhenActive: true,
        content: <CameraSettings />,
      },
      {
        value: "screen",
        label: "Screen share",
        content: <ScreenShareSettings />,
      },
    ],
  },
  {
    value: "appearance",
    label: "Appearance",
    icon: PiPaletteFill,
    pages: [
      { value: "theme", label: "Theme", content: <ThemeSettings /> },
      { value: "display", label: "Display", content: <DisplaySettings /> },
    ],
  },
  {
    value: "behaviour",
    label: "App",
    icon: PiFadersHorizontalFill,
    pages: [
      ...(isElectron()
        ? [{ value: "desktop", label: "Desktop", content: <DesktopSettings /> }]
        : []),
      { value: "hotkeys", label: "Hotkeys", content: <HotkeySettings /> },
      {
        value: "advanced",
        label: "Advanced",
        mountWhenActive: true,
        content: <AdvancedSettings />,
      },
    ],
  },
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
    label: "Addons",
    icon: PiPuzzlePieceFill,
    content: <AddonsSettings />,
  },
  {
    value: "about",
    label: "About",
    icon: PiInfoFill,
    pages: [
      { value: "about", label: "About", content: <AboutSettings /> },
      { value: "updates", label: "Updates", content: <UpdatesSettings /> },
    ],
  },
  {
    value: "support",
    label: "Support Gryt",
    icon: PiHeartFill,
    pinBottom: true,
    content: <SupportSettings />,
  },
];

const MAIN_DESTINATIONS = DESTINATIONS.filter((d) => !d.pinBottom);
const PINNED_DESTINATIONS = DESTINATIONS.filter((d) => d.pinBottom);

/** The rail as one Select, for a window too narrow for it. A category's pages are a group. */
const PICKER_OPTIONS = DESTINATIONS.map(({ value, label, icon, pages }) =>
  pages
    ? { label, options: pages.map((page) => ({ value: `${value}/${page.value}`, label: page.label, icon })) }
    : { value, label, icon },
);

const DEFAULT_DESTINATION = "profile";

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
  // destination, so a second result inside the same destination still scrolls.
  const [jump, setJump] = useState(0);
  const pendingScroll = useRef<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchSettings(query), [query]);
  const searching = query.trim().length > 0;

  const railFits = useRoomForSettingsRail(USER_SETTINGS_CHROME);
  // Without the rail the results take the page's place, so picking one hides them until the field is used again.
  const [resultsOpen, setResultsOpen] = useState(true);
  const resultsInPage = searching && !railFits && resultsOpen;

  /* Where the persisted value points, as a destination and a page inside it. A
     bare "sound-video" resolves, and so does a bare page name like "audio". */
  const [active, activePage] = useMemo(() => {
    const [first, second] = (settingsTab ?? "").split("/");

    const destination =
      DESTINATIONS.find((d) => d.value === first) ??
      DESTINATIONS.find((d) => d.pages?.some((page) => page.value === first));

    if (!destination) return [DEFAULT_DESTINATION, null] as const;
    if (!destination.pages) return [destination.value, null] as const;

    const wanted = destination.value === first ? second : first;
    const page =
      destination.pages.find((p) => p.value === wanted) ?? destination.pages[0];
    return [destination.value, page.value] as const;
  }, [settingsTab]);

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
      setResultsOpen(false);
      setJump((n) => n + 1);
      changeDestination(
        entry.page ? `${entry.destination}/${entry.page}` : entry.destination,
      );
      // The query deliberately survives, so you can click through several
      // candidates rather than retyping the search after every guess.
    },
    [changeDestination],
  );

  // Runs after the destination has rendered, since neither the scroll target
  // nor the new content exists in the DOM until then.
  useEffect(() => {
    // Cleared in the frame, not here: useSettings is a singleton, so this runs once for
    // `jump` and again a render later for the destination, which cancels the first frame.
    const id = pendingScroll.current;

    // Switching destination starts you at the top. Without this the new panel
    // inherits the previous scroll position and opens partway down.
    if (!id) {
      contentRef.current?.scrollTo({ top: 0 });
      return;
    }

    // Re-highlighting the same setting needs the class removed first, or the
    // animation does not restart.
    setHighlighted(null);

    const frame = requestAnimationFrame(() => {
      pendingScroll.current = null;
      const el = contentRef.current?.querySelector<HTMLElement>(
        `[data-setting="${id}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlighted(id);
    });

    return () => cancelAnimationFrame(frame);
  }, [active, activePage, jump]);

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
      /* The tour lives in its own portal, so pressing Next counts as a press
         outside this dialog. Base UI gives the reason, so it can be excepted. */
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
        {/*
          A width, not a ceiling. `max-w-225` did nothing here: the shared popup
          sets an explicit width, and a max-width cannot widen anything — so the
          only thing deciding the size was the inline `minWidth`, and settings
          sat at exactly 600px with a nav column and a content column splitting
          it between them.

          `max-w` still caps it against small viewports, and the height stays
          inline because it is a fixed frame the panes scroll inside rather than
          something that should grow with content. Capped against the viewport
          too, so a short window doesn't push the top and bottom off screen.
        */}
        <Dialog.Popup
          data-gryt="settings"
          className="w-[60rem] max-w-[calc(100vw-3rem)]"
          style={{ height: "min(700px, calc(100vh - 3rem))" }}
        >
        <Dialog.Close style={{ position: "absolute", top: "8px", right: "8px" }}>
          <IconButton data-tour="settings-close">
            <PiX size={16} />
          </IconButton>
        </Dialog.Close>

        <style>{`
          [data-setting].gryt-setting-hit {
            animation: gryt-setting-hit ${HIGHLIGHT_MS}ms ease-out;
            border-radius: var(--gryt-radius-md);
          }
          @keyframes gryt-setting-hit {
            0%, 55% {
              background-color: var(--gryt-accent-a4);
              box-shadow: 0 0 0 8px var(--gryt-accent-a4);
            }
            100% {
              background-color: transparent;
              box-shadow: 0 0 0 8px transparent;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            [data-setting].gryt-setting-hit {
              animation: none;
              outline: 2px solid var(--gryt-accent-9);
              outline-offset: 5px;
            }
          }
        `}</style>

        <div className="flex flex-col gap-4 h-full">
          <Dialog.Title>
            Settings
          </Dialog.Title>

          {showSettings && (
            <div className={`flex gap-4 h-full min-w-0 ${railFits ? "" : "flex-col"}`} style={{ flex: 1, minHeight: 0 }}>
              <div style={{
                  width: railFits ? "220px" : undefined,
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
                    onChange={(e) => {
                      setQuery(e.currentTarget.value);
                      setResultsOpen(true);
                    }}
                    onFocus={() => setResultsOpen(true)}
                    onClick={() => setResultsOpen(true)}
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

                {!railFits && !resultsInPage && (
                  <SettingsPicker
                    value={activePage ? `${active}/${activePage}` : active}
                    onValueChange={changeDestination}
                    options={PICKER_OPTIONS}
                  />
                )}

                <div hidden={!railFits} style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
                  {searching && railFits ? (
                    <SearchResults results={results} onPick={jumpTo} picked={picked} />
                  ) : (
                    <div className="flex flex-col gap-1 h-full">
                      {MAIN_DESTINATIONS.map(({ value, label, icon: Icon, pages }) => (
                        <Fragment key={value}>
                          {/* A category holding the page you are on is marked
                              open, not active: two filled rows read as two
                              selections. */}
                          <button
                            type="button"
                            onClick={() => changeDestination(value)}
                            className="gryt-settings-nav"
                            data-tour={`settings-${value}`}
                            data-active={value === active && !pages?.length}
                            data-open={value === active && !!pages?.length}
                            aria-expanded={pages?.length ? value === active : undefined}
                          >
                            <Icon size={16} />
                            {label}
                          </button>

                          {/* Only the category you are in opens. All ten at
                              once is the scroll this replaced. */}
                          <AnimatePresence initial={false}>
                            {value === active && !!pages?.length && (
                              <motion.div
                                key={`${value}-pages`}
                                className="gryt-settings-subnav-group"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                              >
                                {pages.map((page) => (
                                  <button
                                    key={page.value}
                                    type="button"
                                    onClick={() => changeDestination(`${value}/${page.value}`)}
                                    className="gryt-settings-nav gryt-settings-subnav"
                                    data-active={page.value === activePage}
                                    aria-current={page.value === activePage ? "page" : undefined}
                                  >
                                    {page.label}
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </Fragment>
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

              {resultsInPage && (
                <div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
                  <SearchResults results={results} onPick={jumpTo} picked={picked} />
                </div>
              )}

              {/* A page too wide for the window scrolls sideways. It used to be
                  clipped, which cut buttons off where nobody could reach them. */}
              <div ref={contentRef} hidden={resultsInPage} style={{
                  flex: 1,
                  overflow: "auto",
                  minWidth: 0,
                  minHeight: 0,
                }}>
                {DESTINATIONS.map(({ value, content, pages }) => (
                  <div key={value} hidden={value !== active}>
                    {pages
                      ? pages.map((page) => {
                          const shown = value === active && page.value === activePage;
                          return (
                            <div key={page.value} hidden={!shown}>
                              {page.mountWhenActive ? shown && page.content : page.content}
                            </div>
                          );
                        })
                      : content}
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
            font-size: 14px;
            padding: 8px 10px;
            border-radius: var(--gryt-radius-md);
            border: 0;
            cursor: pointer;
            background: transparent;
            color: var(--gryt-neutral-12);
          }
          .gryt-settings-nav:hover { background: var(--gryt-neutral-a3); }
          /* The animated wrapper. Clipped, so the height tween has an edge to
             move, and it carries the column gap the buttons lost. */
          .gryt-settings-subnav-group {
            display: flex;
            flex-direction: column;
            flex-shrink: 0;
            gap: 4px;
            overflow: hidden;
          }
          /* Indented to the width of the icon above it, so a page lines up
             under its category's label rather than under its icon. */
          .gryt-settings-subnav {
            padding-left: 34px;
            font-size: 13px;
            color: var(--gryt-neutral-11);
            /* The rule is what makes these read as inside the category rather
               than as more categories; the indent alone never did. */
            border-left: 1px solid var(--gryt-neutral-a4);
            border-top-left-radius: 0;
            border-bottom-left-radius: 0;
            margin-left: 17px;
            padding-left: 17px;
          }
          .gryt-settings-nav[data-active="true"] {
            background: var(--gryt-accent-a3);
            color: var(--gryt-accent-11);
            font-weight: 600;
          }
          .gryt-settings-subnav[data-active="true"] {
            border-left-color: var(--gryt-accent-9);
          }
          /* Open, not active. You are somewhere inside this, and the filled row
             below says where — so this only tints its text. */
          .gryt-settings-nav[data-open="true"] {
            color: var(--gryt-accent-11);
            font-weight: 600;
          }
          /* The pinned Support row is the rail's one accent CTA, not a danger state. */
          .gryt-settings-nav-cta {
            background: var(--gryt-accent-9);
            color: var(--gryt-on-accent);
            font-weight: 600;
          }
          .gryt-settings-nav-cta:hover {
            background: var(--gryt-accent-10);
            color: var(--gryt-on-accent);
          }
          .gryt-settings-nav-cta[data-active="true"] {
            background: var(--gryt-accent-10);
            color: var(--gryt-on-accent);
          }
          .gryt-settings-nav-cta svg { color: currentColor; }
          .gryt-settings-result {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 1px;
            width: 100%;
            text-align: left;
            font: inherit;
            padding: 7px 10px;
            border-radius: var(--gryt-radius-md);
            border: 0;
            cursor: pointer;
            background: transparent;
          }
          .gryt-settings-result:hover { background: var(--gryt-neutral-a3); }
          .gryt-settings-result[data-picked="true"] {
            background: var(--gryt-accent-a3);
            color: var(--gryt-accent-11);
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
