import { Divider } from "@gryt/ui";
import type { ReactNode } from "react";

/**
 * A rule with something written in the middle of it.
 *
 * The chat log has two — the date separator and "New since last visit" — and
 * the channel list has a third for a sidebar separator row. All three were the
 * same construction written out longhand: a flex row, two `<div style={{flex:
 * 1, height: 1, background: … }}/>`, a label between them. They had already
 * drifted on padding and on which neutral step the rule used.
 *
 * `Divider` has no label slot, so this is two of them either side of the label
 * rather than anything new. `tone` is a class rather than a prop because the
 * only two in use are the border and danger, and a colour argument invites a
 * third that nobody measured.
 */
export function LabelledDivider({
  children,
  className,
  lineClassName,
  labelClassName,
}: {
  children?: ReactNode;
  className?: string;
  /** Overrides the rule colour. Defaults to the same border everything uses. */
  lineClassName?: string;
  labelClassName?: string;
}) {
  // Nothing to write in the middle: one rule across, rather than two halves
  // meeting at a gap.
  if (!children) {
    return <Divider className={lineClassName} />;
  }

  return (
    <div className={`flex w-full items-center gap-3 ${className ?? ""}`}>
      <Divider className={`flex-1 ${lineClassName ?? ""}`} />
      <span className={`shrink-0 whitespace-nowrap text-xs ${labelClassName ?? "text-gryt-muted"}`}>
        {children}
      </span>
      <Divider className={`flex-1 ${lineClassName ?? ""}`} />
    </div>
  );
}
