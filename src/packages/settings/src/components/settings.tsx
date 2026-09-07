import { Dialog, IconButton, TextField } from "@gryt/ui";
import type { ReactNode } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSettings } from "@/settings";

import { isElectron } from "../../../../lib/electron";
import { PiBellFill, PiFadersHorizontalFill, PiFlaskFill, PiHardDrivesFill, PiHeartFill, PiInfoFill, PiMagnifyingGlassFill, PiMicrophoneFill, PiPaletteFill, PiPuzzlePieceFill, PiShieldCheckFill, PiUserFill, PiX } from "../../../../lib/icons";
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
 * Five destinations named for what you are trying to do rather than which
 * subsystem owns the setting.
 *
 * `mountWhenActive` panels touch hardware — microphone analysers, camera
 * preview — so they mount only while their destination is open.
 */
/**
 * Where things live, named with the word people already scan for.
 *
 * These used to read "How Gryt looks" and "How Gryt behaves". The pair was
 * accurate and it made you parse a sentence to find a row, which is the one
 * thing a settings rail must not do. Appearance and Behaviour say the same
 * and are caught at a glance.
 *
 * Icons are picked to separate rows rather than to decorate them. Profile and
 * Account were a person and a person-in-a-circle side by side, which told you
 * nothing about which held your passkeys; Appearance was a gear, which is what
 * the whole dialog is.
 *
 * A destination with `pages` is a category rather than a page: the rail nests
 * them under it and the pane shows one at a time. That replaces stacking four
 * panels behind dividers, where Sound & video was a single scroll holding the
 * microphone, voice, camera and screen share.
 *
 * `mountWhenActive` panels touch hardware — microphone analysers, camera
 * preview — so they mount only while you are on them. Splitting the category
 * made that finer: opening Sound & video no longer starts the camera because
 * you wanted the microphone.
 */
interface SettingsPage {
  value: string;
  label: string;
  content: ReactNode;
  /** Mount only while you are on it. For panels that hold hardware open. */
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
    label: "Account",
    icon: PiShieldCheckFill,
    pages: [
      { value: "account", label: "Account", content: <AccountSettings /> },
      { value: "security", label: "Security", content: <SecuritySettings /> },
      {
        value: "identities",
        label: "Server identities",
        content: <ServerIdentitySettings />,
      },
    ],
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
      { value: "theme", label: "Theme", content: <AppearanceSettings /> },
      { value: "chat", label: "Chat", content: <ChatSettings /> },
    ],
  },
  {
    /* Its own destination rather than a section inside "How Gryt behaves".
       It had four settings there; it now carries the global level and a row
       per server, which is a page rather than a paragraph. */
    value: "notifications",
    label: "Notifications",
    icon: PiBellFill,
    content: <NotificationSettings />,
  },
  {
    value: "behaviour",
    label: "Behaviour",
    icon: PiFadersHorizontalFill,
    pages: [
      { value: "hotkeys", label: "Hotkeys", content: <HotkeySettings /> },
      { value: "presence", label: "Presence", content: <PresenceSettings /> },
      ...(isElectron()
        ? [{ value: "desktop", label: "Desktop", content: <DesktopSettings /> }]
        : []),
      { value: "advanced", label: "Advanced", content: <AdvancedSettings /> },
    ],
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
    value: "about",
    label: "About",
    icon: PiInfoFill,
    pages: [
      { value: "updates", label: "Updates", content: <UpdatesSettings /> },
      { value: "about", label: "About", content: <AboutSettings /> },
    ],
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

const DEFAULT_DESTINATION = "profile";

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

  /* Where the persisted value points, as a destination and a page inside it.
     Stored as "sound-video/camera", and a bare "sound-video" still resolves —
     both because that is every value written before this existed, and because
     the callers that send you here mostly name a category.

     A bare page name resolves too. useChannelSettings has always called
     setSettingsTab("audio") when the microphone is missing, which matched no
     destination, so the toast said "Settings → Audio" and the dialog opened on
     Profile. Looking through the pages is what makes that land. */
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
      setJump((n) => n + 1);
      changeDestination(
        entry.page ? `${entry.destination}/${entry.page}` : entry.destination,
      );
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
      /* The tour lives in a portal of its own, so pressing Next on a coach mark
         counts as a press outside this dialog and used to dismiss it. The panel
         closed on every step change and the next step opened it again.

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
        {/*
          A width, not a ceiling. `max-w-225` did nothing here: the shared popup
          sets an explicit width, and a max-width cannot widen anything — so the
          only thing deciding the size was the inline `minWidth`, and settings
          sat at exactly 600px with a nav column and a content column splitting
          it between them.

          `max-w` still caps it against small viewports, and the height stays
          inline because it is a fixed frame the panes scroll inside rather than
          something that should grow with content.
        */}
        <Dialog.Popup
          data-gryt="settings"
          className="w-[60rem] max-w-[calc(100vw-3rem)]"
          style={{ height: "700px" }}
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
                      {MAIN_DESTINATIONS.map(({ value, label, icon: Icon, pages }) => (
                        <Fragment key={value}>
                          <button
                            type="button"
                            onClick={() => changeDestination(value)}
                            className="gryt-settings-nav"
                            data-tour={`settings-${value}`}
                            data-active={value === active}
                          >
                            <Icon size={16} />
                            {label}
                          </button>

                          {/* Only the category you are in opens. All ten at
                              once is the scroll this replaced. */}
                          {value === active &&
                            pages?.map((page) => (
                              <button
                                key={page.value}
                                type="button"
                                onClick={() => changeDestination(`${value}/${page.value}`)}
                                className="gryt-settings-nav gryt-settings-subnav"
                                data-active={page.value === activePage}
                              >
                                {page.label}
                              </button>
                            ))}
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

              <div ref={contentRef} style={{
                  flex: 1,
                  overflowY: "auto",
                  overflowX: "hidden",
                  minWidth: 0,
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
          /* Indented to the width of the icon above it, so a page lines up
             under its category's label rather than under its icon. */
          .gryt-settings-subnav {
            padding-left: 34px;
            font-size: 13px;
            color: var(--gryt-neutral-11);
          }
          .gryt-settings-nav[data-active="true"] {
            background: var(--gryt-accent-a3);
            color: var(--gryt-accent-11);
          }
          /* Just the heart carries the colour. A filled button competes with
             the active-item highlight and shouts in a settings sidebar; a red
             heart against grey labels catches the eye on its own. */
          .gryt-settings-nav-cta svg { color: var(--gryt-danger-9); }
          .gryt-settings-nav-cta:hover svg { color: var(--gryt-danger-10); }
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
