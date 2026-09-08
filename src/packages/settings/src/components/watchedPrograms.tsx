import { Button, Select, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

import type { WatchedProgram } from "../../../../lib/electron";
import { useWatchedPrograms } from "../hooks/useWatchedPrograms";

/**
 * The programs you want seen, under the line you type yourself. Gryt looks at
 * what is running and tells anybody only about this list (GRYT-931).
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
               and refused: an option that does nothing is worse than none. */
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
