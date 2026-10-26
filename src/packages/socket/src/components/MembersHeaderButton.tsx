import { Popover, Tooltip } from "@gryt/ui";
import type { ComponentProps } from "react";

import { PiUsersBold } from "../../../../lib/icons";
import { MemberSidebar } from "./MemberSidebar";

/** Where the member list goes when even the avatar column won't fit: a button in the chat header (GRYT-1899). */
export function MembersHeaderButton(props: ComponentProps<typeof MemberSidebar>) {
  const online = props.members.filter((m) => m.status !== "offline").length;
  return (
    <Popover.Root>
      <Tooltip title="Members">
        <Popover.Trigger
          aria-label={`Members, ${online} online`}
          data-gryt="members-button"
          render={
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-2 py-1 text-xs font-bold"
              style={{ color: "var(--gryt-neutral-11)" }}
            />
          }
        >
          <PiUsersBold size={14} />
          {online}
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8}>
          <Popover.Popup
            initialFocus={(type) => type === "keyboard"}
            style={{ padding: 0, height: "min(560px, 70vh)", maxWidth: "none", overflow: "hidden" }}
          >
            <MemberSidebar {...props} width={240} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
