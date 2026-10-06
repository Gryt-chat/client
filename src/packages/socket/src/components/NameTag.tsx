import { Tooltip } from "@gryt/ui";

/** The tag after a name somebody else here also uses (GRYT-1674). Muted, so the
    name still reads first; the full fingerprint is on the member's card. */
export function NameTag({ tag, tooltip = true }: { tag: string | undefined; tooltip?: boolean }) {
  if (!tag) return null;
  const text = (
    <span
      className="gryt-name-tag"
      style={{
        fontFamily: "var(--gryt-font-mono, ui-monospace, monospace)",
        fontSize: "0.85em",
        fontWeight: 500,
        color: "var(--gryt-neutral-10)",
        whiteSpace: "nowrap",
      }}
    >
      · {tag}
    </span>
  );
  if (!tooltip) return text;
  return (
    <Tooltip title="Someone else here uses this name too. This tag comes from their fingerprint, so it tells the two apart.">
      {text}
    </Tooltip>
  );
}
