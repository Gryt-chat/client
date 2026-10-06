import { Tooltip } from "@gryt/ui";

/** The number after a name somebody else here also uses (GRYT-1674): #1 joined
    first. Muted, so the name still reads first; the fingerprint is on the card. */
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
      {tag}
    </span>
  );
  if (!tooltip) return text;
  return (
    <Tooltip title="Someone else here uses this name too. #1 joined first, #2 after them, and so on.">
      {text}
    </Tooltip>
  );
}
