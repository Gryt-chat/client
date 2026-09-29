import { TextField } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";

import { DEFAULT_ICON } from "../../../socket/src/components/memberCard/patternAssets";
import { ICON_NAMES, loadIconMark } from "../../../socket/src/components/memberCard/phosphorIcons";

/** How many matches are drawn at once; each one is its own small chunk. */
const SHOWN = 48;

function IconCell({ name, picked, onPick }: { name: string; picked: boolean; onPick: () => void }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadIconMark(name).then((mark) => {
      if (live && mark) setSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mark.viewBox}" fill="currentColor">${mark.body}</svg>`);
    });
    return () => {
      live = false;
    };
  }, [name]);
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={picked}
      onClick={onPick}
      className="grid h-9 cursor-pointer place-items-center rounded-(--gryt-radius-sm) border-0 bg-gryt-surface-raised p-1.5 text-gryt-text hover:bg-gryt-surface-hover"
      style={{ boxShadow: picked ? "0 0 0 2px var(--gryt-text)" : undefined }}
    >
      {/* Our own markup, built from Phosphor's path data, not anything a person typed. */}
      {svg && <span className="block h-5 w-5" dangerouslySetInnerHTML={{ __html: svg }} />}
    </button>
  );
}

/** Search every Phosphor icon by name and pick the one to strew. */
export default function CardIconPicker({ value, onPick }: { value?: string; onPick: (name: string) => void }) {
  const [query, setQuery] = useState("");
  const current = value ?? DEFAULT_ICON;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "-");
    const all = q ? ICON_NAMES.filter((n) => n.includes(q)) : ICON_NAMES;
    return [current, ...all.filter((n) => n !== current)].slice(0, SHOWN);
  }, [query, current]);
  return (
    <div className="flex flex-col gap-2">
      <TextField placeholder="Search icons, like star or coffee" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-1">
        {matches.map((name) => (
          <IconCell key={name} name={name} picked={name === current} onPick={() => onPick(name)} />
        ))}
      </div>
      <span className="text-xs text-gryt-muted">
        {ICON_NAMES.length} icons from Phosphor. Showing {matches.length}; search to find the rest.
      </span>
    </div>
  );
}
