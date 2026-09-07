import { Chip } from "@gryt/ui";

import type { ForumTag } from "@/settings/src/types/server";

/**
 * One forum tag: a colour swatch, the emoji if it has one, and the name.
 *
 * There were three copies of this — the filter row, the topic row and the
 * new-topic composer — each writing out the same inline-flex pill by hand, and
 * they had already drifted on padding and font size. The swatch is a square
 * rather than a dot on purpose: a round swatch next to a round pill reads as a
 * bullet, and the tag's colour is the thing being shown.
 *
 * `pressable` is what the filter row and the composer need. A tag on a topic
 * row is a label, not a control, so it renders as a plain chip with no button
 * semantics — a row of fake buttons inside a real one is what it was before.
 */
export function ForumTagChip({
  tag,
  active,
  onToggle,
}: {
  tag: ForumTag;
  /** Selected, in a row somebody is filtering or composing with. */
  active?: boolean;
  /** Absent makes it a label rather than a control. */
  onToggle?: () => void;
}) {
  const chip = (
    <Chip
      tone={active ? "primary" : "neutral"}
      className="gap-1.5 px-2.5 py-0.5 text-[11.5px]"
      icon={
        <span
          aria-hidden="true"
          className="size-[7px] shrink-0 rounded-[2px]"
          style={{ background: tag.color || "var(--gryt-accent-9)" }}
        />
      }
      label={`${tag.emoji ? `${tag.emoji} ` : ""}${tag.name}`}
    />
  );

  if (!onToggle) return chip;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className="cursor-pointer appearance-none rounded-(--gryt-radius-full) border-0 bg-transparent p-0"
    >
      {chip}
    </button>
  );
}
