import { Button } from "@gryt/ui";

import { isMacAppStoreBuild, type RichPresenceApp } from "../../../../lib/electron";
import { GameIcon } from "../../../socket/src/components/GameIcon";
import { usePresenceHelper } from "../hooks/usePresenceHelper";
import { useRichPresence } from "../hooks/useRichPresence";
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
        <span className="text-xs text-gryt-muted">
          To do it, Gryt opens the same local connection Discord listens on. While Gryt has it,
          games report to Gryt instead of Discord. Any program on this computer can talk to that
          connection, not only games, so you can hide one here once it shows up.
        </span>
        <span className="text-xs text-gryt-muted">
          People on your servers see the game&rsquo;s name and what it says about your game.
          Nothing else leaves this computer.
        </span>
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
                {app.name ?? `Unknown app ${app.id}`}
              </span>
              {hiddenIds.has(app.id) && <span className="text-xs text-gryt-muted">hidden</span>}
              <Button size="xsmall" tone="neutral" onClick={() => toggle(app)}>
                {hiddenIds.has(app.id) ? "Show" : "Hide"}
              </Button>
            </li>
          ))}
        </ul>
      )}

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
