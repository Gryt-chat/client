import { Button, Select, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

import type { WatchedProgram } from "../../../../lib/electron";
import { useWatchedPrograms } from "../hooks/useWatchedPrograms";

/**
 * The programs you want seen, under the line you type yourself (GRYT-931).
 *
 * The trade this screen exists to make legible: Gryt looks at what is running,
 * and only tells anybody about the things on this list. Nothing else you have
 * open is reported to a server, a plugin, or us — and the copy says so, because
 * "Gryt reads your process list" is the sentence somebody will otherwise assume.
 *
 * Picking from what is open rather than typing an executable name is the whole
 * usability of it. A person knows they are running Factorio; they do not know
 * whether the binary is `factorio`, `Factorio.exe` or `factorio-run`. The list
 * is filtered to things that look like applications — 1178 processes come down
 * to about 40 on a Mac — and there is still a text field beside it for anything
 * the filter was too eager about.
 */
export function WatchedPrograms() {
  const { supported, watched, running, setWatched, listRunning } = useWatchedPrograms();

  const [open, setOpen] = useState<string[]>([]);
  const [picked, setPicked] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);

  // Only when the section is on screen, and only once — this spawns a `ps`.
  useEffect(() => {
    if (!supported) return;
    setLoading(true);
    void listRunning().then((names) => {
      setOpen(names);
      setLoading(false);
    });
  }, [supported, listRunning]);

  if (!supported) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-bold">What you&rsquo;re playing</span>
        <span className="text-xs text-gryt-muted">
          Only the desktop app can see what you have open. In a browser
          there&rsquo;s nothing to look at.
        </span>
      </div>
    );
  }

  const add = async () => {
    const match = picked.trim();
    if (!match) return;

    // Default the label to the executable minus its extension, which is right
    // often enough — `Factorio.exe` becomes `Factorio`.
    const name = label.trim() || match.replace(/\.exe$/i, "");

    await setWatched([...watched, { match, name }]);
    setPicked("");
    setLabel("");
  };

  const remove = (entry: WatchedProgram) =>
    setWatched(watched.filter((w) => w.match !== entry.match));

  const refresh = async () => {
    setLoading(true);
    setOpen(await listRunning());
    setLoading(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold">What you&rsquo;re playing</span>
      <span className="text-xs text-gryt-muted">
        List a program and Gryt says its name under yours while it&rsquo;s
        running, instead of the line above. Nothing else you have open is
        looked at or sent anywhere.
      </span>

      {watched.length > 0 && (
        <ul className="flex flex-col gap-1 m-0 p-0 list-none">
          {watched.map((entry) => (
            <li
              key={entry.match}
              className="flex items-center gap-2 rounded-md px-2 py-1"
              style={{ background: "var(--gryt-neutral-3)" }}
            >
              <span className="text-sm font-medium">{entry.name}</span>
              <span className="text-xs text-gryt-muted" style={{ flex: 1, minWidth: 0 }}>
                {entry.match}
              </span>
              {running.includes(entry.name) && (
                <span className="text-xs" style={{ color: "var(--gryt-success-9)" }}>
                  running
                </span>
              )}
              <Button size="xsmall" tone="neutral" onClick={() => void remove(entry)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
          <span className="text-xs text-gryt-muted">Something you have open</span>
          <Select
            value={picked}
            onValueChange={(value) => setPicked(String(value ?? ""))}
            /* Anything already listed is gone from the picker rather than shown
               and refused — the list stops the duplicate anyway, and an option
               that does nothing when you choose it is worse than no option. */
            options={open
              .filter((name) => !watched.some((w) => w.match === name))
              .map((name) => ({ value: name, label: name }))}
            placeholder={loading ? "Looking…" : "Pick a program"}
          />
        </div>

        <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
          <span className="text-xs text-gryt-muted">Call it</span>
          <TextField
            placeholder={picked ? picked.replace(/\.exe$/i, "") : "Factorio"}
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <Button size="small" onClick={() => void add()} disabled={!picked}>
          Add
        </Button>
        <Button size="small" tone="neutral" onClick={() => void refresh()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {open.length === 0 && !loading && (
        <span className="text-xs text-gryt-muted">
          Nothing came back. Start the program first, then Refresh.
        </span>
      )}
    </div>
  );
}
