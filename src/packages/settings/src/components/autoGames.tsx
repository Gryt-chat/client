import { Button } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { type AutoGamesStatus, getElectronAPI, isElectron } from "../../../../lib/electron";

const EMPTY: AutoGamesStatus = { supported: false, consentedAt: null, running: [], seen: [], hidden: [] };

/**
 * Automatic mode, under watched programs and with its own switch. It reads every
 * running program, which watched programs deliberately never did (GRYT-1310).
 */
export function AutoGames() {
  const api = isElectron() ? getElectronAPI() : null;
  const [status, setStatus] = useState<AutoGamesStatus>(EMPTY);

  const refresh = useCallback(async () => {
    const next = await api?.getAutoGames?.();
    if (next) setStatus(next);
  }, [api]);

  useEffect(() => {
    void refresh();
    return api?.onAutoGamesChanged?.(() => void refresh());
  }, [api, refresh]);

  // The browser and the Mac App Store build can't list programs, and the watched programs section already says so.
  if (!status.supported) return null;

  const setConsent = async (allow: boolean) => {
    await api?.setAutoGamesConsent?.(allow);
    await refresh();
  };

  const toggle = async (name: string) => {
    const hidden = status.hidden.includes(name)
      ? status.hidden.filter((n) => n !== name)
      : [...status.hidden, name];
    await api?.setAutoGamesHidden?.(hidden);
    await refresh();
  };

  if (!status.consentedAt) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold">Spot games automatically</span>
        <span className="text-xs text-gryt-muted">
          Gryt can spot a game you&rsquo;re playing without you adding it, the way Discord does.
          It ships with a list of about a hundred games.
        </span>
        <span className="text-xs text-gryt-muted">
          This works differently from the programs you pick above. To spot a game, Gryt reads the
          name of every program running on this computer every ten seconds and checks it against
          that list. The list of what&rsquo;s running stays on this computer. Only the name of a game
          it recognises goes to your servers.
        </span>
        <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
          <Button size="small" onClick={() => void setConsent(true)}>
            Turn on
          </Button>
        </div>
      </div>
    );
  }

  const listed = [...new Set([...status.seen, ...status.hidden])].sort((a, b) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold">Spot games automatically</span>
      <span className="text-xs text-gryt-muted">
        {status.running.length > 0
          ? `Spotted now: ${status.running.join(", ")}.`
          : "No game from the list is running right now."}
      </span>

      {listed.length > 0 && (
        <ul className="flex flex-col gap-1 m-0 p-0 list-none">
          {listed.map((name) => (
            <li
              key={name}
              className="flex items-center gap-2 rounded-md px-2 py-1"
              style={{ background: "var(--gryt-neutral-3)" }}
            >
              <span className="text-sm font-medium" style={{ flex: 1, minWidth: 0 }}>
                {name}
              </span>
              {status.hidden.includes(name) && <span className="text-xs text-gryt-muted">hidden</span>}
              <Button size="xsmall" tone="neutral" onClick={() => void toggle(name)}>
                {status.hidden.includes(name) ? "Show" : "Hide"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
        <Button size="xsmall" tone="neutral" onClick={() => void setConsent(false)}>
          Turn off
        </Button>
        <span className="text-xs text-gryt-muted">Gryt stops reading the list of running programs.</span>
      </div>
    </div>
  );
}
