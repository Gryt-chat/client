import { Avatar, Popover, Tooltip } from "@gryt/ui";
import { type ReactNode, useState } from "react";

import { DiscordLogo } from "../../../../lib/icons";
import { MEMBER_CARD_POPUP } from "./memberCard/memberCardContext";

const DISCORD_BLUE = "#5865F2";

/** The badge alone, over an avatar in a parent with `position: relative`. */
export function DiscordBadgeDot({ size }: { size: number }) {
  return (
    <Tooltip title="Only on Discord">
      <span
        aria-label="Only on Discord"
        role="img"
        className="absolute grid place-items-center rounded-full"
        style={{ right: -2, bottom: -2, width: size, height: size, background: DISCORD_BLUE, boxShadow: "0 0 0 2px var(--gryt-neutral-3)" }}
      >
        <DiscordLogo size={Math.round(size * 0.62)} color="#fff" aria-hidden />
      </span>
    </Tooltip>
  );
}

/** Someone who's only on Discord: a badge where a status dot would sit, and a plain card instead of a Gryt profile. */
export function DiscordOnlyBadge({ name, avatar, status, size, children }: {
  name: string;
  avatar?: string;
  status?: string;
  size: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger nativeButton={false} render={<span className="relative inline-flex shrink-0 cursor-pointer" aria-label={`${name}, only on Discord`} />}>
        {children}
        <Tooltip title="Only on Discord">
          <span
            className="absolute grid place-items-center rounded-full"
            style={{ right: -2, bottom: -2, width: size, height: size, background: DISCORD_BLUE, boxShadow: "0 0 0 2px var(--gryt-neutral-3)" }}
          >
            <DiscordLogo size={Math.round(size * 0.62)} color="#fff" aria-hidden />
          </span>
        </Tooltip>
      </Popover.Trigger>
      {open && (
        <Popover.Portal>
          <Popover.Positioner side="left" align="start">
            <Popover.Popup className={MEMBER_CARD_POPUP}>
              <div className="flex w-72 flex-col overflow-hidden rounded-(--gryt-radius-lg) bg-gryt-neutral-4">
                <div style={{ height: 56, background: DISCORD_BLUE }} />
                <div className="flex flex-col gap-2 px-4 pb-4" style={{ marginTop: -28 }}>
                  <Avatar size="large" className="h-14 w-14 ring-4 ring-gryt-neutral-4" src={avatar} fallback={name[0]} alt="" />
                  <span className="text-base font-bold">{name}</span>
                  <span className="flex items-center gap-1.5 text-sm text-gryt-muted">
                    <DiscordLogo size={13} color={DISCORD_BLUE} aria-hidden /> Only on Discord{status ? ` · ${status}` : ""}
                  </span>
                  <span className="text-sm text-gryt-muted">
                    {name} hasn&rsquo;t joined Gryt. What you write reaches them through the bridge. Once they join and link their Discord account, this becomes their Gryt profile.
                  </span>
                </div>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      )}
    </Popover.Root>
  );
}
