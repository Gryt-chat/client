import { Button } from "@gryt/ui";
import { useEffect, useState } from "react";

import { getElectronAPI, isMacAppStoreBuild, type RichPresenceApp, type RichPresenceLogEntry } from "../../../../lib/electron";
import { GameIcon } from "../../../socket/src/components/GameIcon";
import { useGameDetection } from "../hooks/useGameDetection";
import { usePresenceHelper } from "../hooks/usePresenceHelper";
import { useRichPresence } from "../hooks/useRichPresence";
import { HowItWorks } from "./howItWorks";
import { PresenceHelperSettings } from "./presenceHelper";
import { helperCopy } from "./presenceHelperCopy";
import { socketLine } from "./richPresenceCopy";

/**
 * Games that report what you're doing through Discord's Rich Presence socket.
 * Off until somebody turns it on, since any program on the machine can talk to it (GRYT-1310).
 */
export function RichPresenceSettings() {
  const rp = useRichPresence();
  const helper = usePresenceHelper();

  if (!rp.supported) {
    // The browser can't open a local socket, and the web copy of this panel would promise something it can't do.
    if (!isMacAppStoreBuild()) return null;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-bold">Rich Presence</span>
        <span className="text-xs text-gryt-muted">
          The Mac App Store version can&rsquo;t open the connection games use.
        </span>
      </div>
    );
  }

  if (!rp.consentedAt) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold">Rich Presence</span>
        <span className="text-xs text-gryt-muted">
          Lots of games tell Discord what you&rsquo;re up to, like the map you&rsquo;re on or how
          full your party is. Gryt can pick that up and show it under your name.
        </span>
        <HowItWorks>
          <span className="text-xs text-gryt-muted">
            To do it, Gryt opens the same local connection Discord listens on. While Gryt has it,
            games report to Gryt instead of Discord. Any program on this computer can talk to that
            connection, not only games, so you can hide one here once it shows up.
          </span>
          <span className="text-xs text-gryt-muted">
            People on your servers see the game&rsquo;s name and what it says about your game.
            Nothing else leaves this computer.
          </span>
        </HowItWorks>
        <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
          <Button size="small" onClick={() => void rp.setConsent(true)}>
            Turn on
          </Button>
        </div>
      </div>
    );
  }

  const line = socketLine(rp);
  const hiddenIds = new Set(rp.hidden.map((app) => app.id));
  // Hidden apps stay listed after a restart, when nothing has connected yet.
  const apps: RichPresenceApp[] = [...rp.seen, ...rp.hidden.filter((h) => !rp.seen.some((s) => s.id === h.id))];

  // Opens the helper's own box rather than turning it on, since that's where it says what it costs.
  const showHelper = () => {
    document.getElementById("gryt-helper")?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("gryt-helper-on")?.focus({ preventScroll: true });
  };

  const toggle = (app: RichPresenceApp) =>
    void rp.setHidden(hiddenIds.has(app.id) ? rp.hidden.filter((h) => h.id !== app.id) : [...rp.hidden, app]);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold">Rich Presence</span>

      {line.text && (
        <div
          className="flex flex-col gap-1 rounded-md px-2 py-1"
          role={line.warn ? "status" : undefined}
          style={line.warn ? { background: "var(--gryt-warning-3)", color: "var(--gryt-warning-11)" } : undefined}
        >
          <span className={line.warn ? "text-xs" : "text-xs text-gryt-muted"}>{line.text}</span>
          {line.fix && <span className="text-xs">{line.fix}</span>}
          {rp.holder?.isDiscord && helper.offered && !helper.enabledAt && (
            <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
              <Button size="xsmall" onClick={showHelper}>
                {helperCopy.turnOn}
              </Button>
              <span className="text-xs">{helperCopy.warningHint}</span>
            </div>
          )}
        </div>
      )}

      {rp.current && (
        <span className="flex items-center gap-1.5 text-xs text-gryt-muted">
          <GameIcon appId={rp.current.appId} name={rp.current.name} size={16} />
          Showing now: <strong>{rp.current.name}</strong>
          {rp.current.details ? `, ${rp.current.details}` : ""}
        </span>
      )}

      {apps.length > 0 && (
        <ul className="flex flex-col gap-1 m-0 p-0 list-none">
          {apps.map((app) => (
            <li
              key={app.id}
              className="flex items-center gap-2 rounded-md px-2 py-1"
              style={{ background: "var(--gryt-neutral-3)" }}
            >
              <span className="text-sm font-medium" style={{ flex: 1, minWidth: 0 }}>
                {rp.names?.[app.id] ?? app.name ?? `Unknown app ${app.id}`}
              </span>
              {hiddenIds.has(app.id) && <span className="text-xs text-gryt-muted">hidden</span>}
              {(!app.name || rp.names?.[app.id]) && (
                <NameGame id={app.id} current={rp.names?.[app.id] ?? ""} onSave={(name) => void rp.setName(app.id, name)} />
              )}
              <Button size="xsmall" tone="neutral" onClick={() => toggle(app)}>
                {hiddenIds.has(app.id) ? "Show" : "Hide"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ReceivedLog log={rp.log ?? []} refresh={rp.refresh} />

      <GameDetection />

      <PresenceHelperSettings helper={helper} />

      <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
        <Button size="xsmall" tone="neutral" onClick={() => void rp.setConsent(false)}>
          Turn off
        </Button>
        <span className="text-xs text-gryt-muted">
          Gryt lets go of the connection, and Discord gets it back the next time it starts.
        </span>
      </div>
    </div>
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** What games actually sent, so it's clear whether a game talks to Gryt at all. */
function ReceivedLog({ log, refresh }: { log: RichPresenceLogEntry[]; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [open, refresh]);

  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="text-xs text-gryt-muted" style={{ cursor: "pointer", width: "fit-content" }}>
        What Gryt receives
      </summary>
      <div className="flex flex-col gap-1" style={{ marginTop: 4 }}>
        {log.length === 0 ? (
          <span className="text-xs text-gryt-muted">
            Nothing yet. Start a game that has Discord Rich Presence and it shows up here within a
            few seconds. Games that don&rsquo;t have it, like CS2, never connect: add those under
            Programs you add instead.
          </span>
        ) : (
          <ol
            className="flex flex-col gap-0.5 m-0 p-2 list-none rounded-md"
            style={{ background: "var(--gryt-neutral-3)", fontFamily: "var(--font-mono, ui-monospace, monospace)", maxHeight: 220, overflowY: "auto" }}
          >
            {[...log].reverse().map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="text-xs">
                <span className="text-gryt-muted">{time(entry.at)}</span>{" "}
                {entry.appId ? <strong>{entry.name ?? `Unknown app ${entry.appId}`}</strong> : null}
                {entry.appId ? " " : ""}
                {entry.text}
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}

/** Known games spotted by their program. Off until turned on, and asks once per game. */
function GameDetection() {
  const detect = useGameDetection();
  if (!detect.supported) return null;

  return (
    <div className="flex flex-col gap-1 rounded-md px-2 py-2" style={{ background: "var(--gryt-neutral-3)" }}>
      <span className="text-sm font-medium">Spot games and apps</span>
      <span className="text-xs text-gryt-muted">
        For games like CS2 and apps like Figma. Gryt asks once for each before it shows anything.
      </span>
      <HowItWorks>
        <span className="text-xs text-gryt-muted">
          Every ten seconds Gryt checks which programs are running against a public list of about
          10,000 games and a few apps. The list of what you have running never leaves this computer.
        </span>
        <span className="text-xs text-gryt-muted">
          The first time it spots a game it asks whether to show it. Say no and it never shows or asks
          again. A game that reports for itself always wins, since it says more.
        </span>
      </HowItWorks>
      <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
        <Button size="xsmall" tone={detect.enabled ? "neutral" : undefined} onClick={() => void detect.setEnabled(!detect.enabled)}>
          {detect.enabled ? "Turn off" : "Turn on"}
        </Button>
      </div>
      {detect.answers.length > 0 && (
        <ul className="flex flex-col gap-1 m-0 p-0 list-none" style={{ marginTop: 6 }}>
          {detect.answers.map((game) => (
            <li key={game.id} className="flex items-center gap-2 rounded-md px-2 py-1" style={{ background: "var(--gryt-neutral-4)" }}>
              <GameIcon appId={game.id} name={game.name ?? "A game"} size={16} />
              <span className="text-sm" style={{ flex: 1, minWidth: 0 }}>{game.name ?? `Unknown app ${game.id}`}</span>
              <span className="text-xs text-gryt-muted">{game.answer === "show" ? "shown" : "never shown"}</span>
              <Button size="xsmall" tone="neutral" onClick={() => void detect.answer(game.id, game.answer === "show" ? "hide" : "show")}>
                {game.answer === "show" ? "Don't show" : "Show"}
              </Button>
              {/* Takes it off the list; Gryt asks again the next time it spots the game. */}
              <Button size="xsmall" tone="neutral" onClick={() => void detect.answer(game.id, null)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A name for a game no list knows. Kept on this device, with a way to add it for everyone. */
function NameGame({ id, current, onSave }: { id: string; current: string; onSave: (name: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const suggest = () => {
    const title = encodeURIComponent(`Add a game: ${value || current}`);
    const body = encodeURIComponent(`Discord application id: ${id}\nName: ${value || current}\n\nFound through Gryt's Rich Presence, where it showed as an unknown app.`);
    void getElectronAPI()?.openExternal?.(`https://github.com/Gryt-chat/rich-presence/issues/new?title=${title}&body=${body}`);
  };
  if (!editing) {
    return (
      <>
        <Button size="xsmall" tone="neutral" onClick={() => setEditing(true)}>
          {current ? "Rename" : "Name it"}
        </Button>
        {current && (
          <Button size="xsmall" tone="neutral" onClick={suggest}>
            Suggest for everyone
          </Button>
        )}
      </>
    );
  }
  const save = () => {
    onSave(value.trim() || null);
    setEditing(false);
  };
  return (
    <input
      autoFocus
      aria-label="Game name"
      value={value}
      maxLength={64}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") setEditing(false);
      }}
      className="rounded-md border border-gryt-border bg-gryt-surface px-2 py-0.5 text-sm text-gryt-text"
      style={{ width: 140 }}
    />
  );
}
