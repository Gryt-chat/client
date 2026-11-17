import { Button, Surface } from "@gryt/ui";
import { useState } from "react";

import { DiscordLogo } from "../../../../lib/icons";

const key = (host: string) => `gryt:discord-offer-dismissed:${host}`;

function dismissed(host: string): boolean {
  try {
    return localStorage.getItem(key(host)) === "1";
  } catch {
    return false;
  }
}

/** In an empty channel, for the owner only, until "Not now". Server settings → Discord always has it. */
export function DiscordOffer({ host }: { host: string }) {
  const [hidden, setHidden] = useState(() => dismissed(host));
  if (hidden) return null;

  const notNow = () => {
    try {
      localStorage.setItem(key(host), "1");
    } catch {
      /* private mode: it just comes back next time */
    }
    setHidden(true);
  };
  const open = () => window.dispatchEvent(new CustomEvent("server_settings_open", { detail: { host, tab: "discord" } }));

  return (
    <Surface className="flex max-w-[32rem] flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <DiscordLogo size={24} color="#5865F2" />
        <div className="flex flex-col">
          <span className="text-base font-bold">Running a Discord server already?</span>
          <span className="text-sm text-gryt-muted">
            Bring it here: name, picture, channels, emoji and every message. You can keep both in step afterwards.
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="small" onClick={open}>
          <DiscordLogo size={16} /> Bring a Discord server
        </Button>
        <span className="flex-1" />
        <Button size="small" tone="ghost" onClick={notNow}>Not now</Button>
      </div>
    </Surface>
  );
}
