import { Divider } from "@gryt/ui";
import type { ReactNode } from "react";

/**
 * A rule with something written in the middle of it — three longhand copies that
 * had drifted. `tone` is a class, because a colour argument invites a third.
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
