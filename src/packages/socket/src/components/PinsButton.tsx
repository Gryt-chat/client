import { Popover, Tooltip } from "@gryt/ui";
import { useState } from "react";

import { PiPushPinFill } from "../../../../lib/icons";
import type { usePins } from "../hooks/usePins";
import { type ChatMessage, MessageTimestamp, toDate } from "./chatUtils";
import { EmojiText } from "./EmojiText";
import type { MemberInfo } from "./MemberSidebar";

/** The header's pin button and the list it opens (GRYT-1619). Hidden under 360px,
    where a DM header's call buttons already fill the row. */
export function PinsButton({
  pins,
  memberList,
  onJump,
}: {
  pins: ReturnType<typeof usePins>;
  memberList?: Record<string, MemberInfo>;
  onJump: (messageId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const nameOf = (m: ChatMessage) => memberList?.[m.sender_server_id]?.nickname ?? "Someone";

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) pins.fetchList();
      }}
    >
      <Tooltip title="Pinned messages">
        <Popover.Trigger
          aria-label="Pinned messages"
          data-gryt="pins-button"
          render={<button type="button" className="flex cursor-pointer items-center rounded border-0 bg-transparent p-1 max-[360px]:hidden" style={{ color: "var(--gryt-neutral-11)" }} />}
        >
          <PiPushPinFill size={16} />
        </Popover.Trigger>
      </Tooltip>
      {open && (
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={6}>
            <Popover.Popup className="w-80 max-w-[90vw] p-0" data-gryt="pins-list">
              <div className="px-3 py-2 text-sm font-semibold" style={{ borderBottom: "1px solid var(--gryt-neutral-6)" }}>
                Pinned messages
              </div>
              <div className="max-h-96 overflow-y-auto">
                {pins.list === null ? (
                  <div className="px-3 py-4 text-sm" style={{ color: "var(--gryt-neutral-10)" }}>Loading…</div>
                ) : pins.list.length === 0 ? (
                  <div className="px-3 py-4 text-sm" style={{ color: "var(--gryt-neutral-10)" }}>
                    Nothing pinned yet. Right-click a message and pick Pin Message.
                  </div>
                ) : (
                  pins.list.map((m) => (
                    <button
                      key={m.message_id}
                      type="button"
                      className="block w-full cursor-pointer border-0 bg-transparent px-3 py-2 text-left hover:bg-[var(--gryt-neutral-4)]"
                      onClick={() => {
                        setOpen(false);
                        onJump(m.message_id);
                      }}
                    >
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold" style={{ color: "var(--gryt-neutral-12)" }}>{nameOf(m)}</span>
                        <MessageTimestamp date={toDate(m.created_at)} />
                      </div>
                      <div className="line-clamp-3 text-sm" style={{ color: "var(--gryt-neutral-11)", overflowWrap: "anywhere" }}>
                        {m.text ? <EmojiText text={m.text} /> : m.attachments?.length ? "Attachment" : ""}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      )}
    </Popover.Root>
  );
}
