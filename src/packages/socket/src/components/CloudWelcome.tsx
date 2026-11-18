import { Button, Surface } from "@gryt/ui";
import { useEffect, useState } from "react";

import { CheerOwl } from "../../../../components/cheerOwl";
import { Confetti } from "../../../../components/confetti";
import { PiArrowSquareOutBold, PiCaretRightBold, PiCloudFill, PiHashBold, PiUsersThreeFill } from "../../../../lib/icons";
import { useOpenInviteLink } from "../hooks/useOpenInviteLink";

const key = (host: string) => `gryt:cloud-welcome:${host}`;
// shortcut: same guess as Add a server's, until Gryt Cloud is public.
const CONSOLE_URL = "https://cloud.gryt.chat";

/** Set by the console's Open in Gryt link (welcome=1) and by Add a server when the new Cloud server arrives. */
export function markCloudWelcome(host: string) {
  try {
    localStorage.setItem(key(host), "1");
  } catch {
    /* private mode: no welcome, nothing else lost */
  }
}

export function wantsCloudWelcome(host: string): boolean {
  try {
    return localStorage.getItem(key(host)) === "1";
  } catch {
    return false;
  }
}

/** 3.5: the owner's first open of a brand-new Gryt Cloud server. Shown once. */
export function CloudWelcome({ host, serverName }: { host: string; serverName: string }) {
  const invite = useOpenInviteLink(host);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    try {
      localStorage.removeItem(key(host));
    } catch {
      /* it shows again next time, which is harmless */
    }
  }, [host]);

  const copy = async () => {
    if (invite.available) {
      await invite.copy();
      setCopied(true);
    } else window.dispatchEvent(new CustomEvent("server_settings_open", { detail: { host, tab: "invites" } }));
  };
  const settings = () => window.dispatchEvent(new CustomEvent("server_settings_open", { detail: { host } }));

  return (
    <div className="flex w-full max-w-[30rem] flex-col gap-4 px-5">
      <span className="relative flex self-center">
        <Confetti />
        <CheerOwl />
      </span>
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="text-2xl font-bold" style={{ textWrap: "balance" }}>
          Welcome to your brand new server! 🎉
        </span>
        <span className="text-sm text-gryt-muted">{serverName} is yours. Here’s where to start.</span>
      </div>
      <Surface className="flex flex-col p-0">
        <div className="flex items-center gap-3 px-4 py-3">
          <Tile icon={<PiUsersThreeFill size={18} />} />
          <span className="flex-1 text-sm font-bold">Invite your friends</span>
          <Button size="small" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy invite"}
          </Button>
        </div>
        <button type="button" onClick={settings} className="flex cursor-pointer items-center gap-3 border-0 border-t border-solid border-gryt-border bg-transparent px-4 py-3 text-left text-gryt-text">
          <Tile icon={<PiHashBold size={18} />} />
          <span className="flex flex-1 flex-col">
            <span className="text-sm font-bold">Server settings</span>
            <span className="text-xs text-gryt-muted">Channels, roles, members</span>
          </span>
          <PiCaretRightBold size={14} className="text-gryt-muted" />
        </button>
        <a href={`${CONSOLE_URL}/servers/${encodeURIComponent(host)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 border-t border-gryt-border px-4 py-3 text-gryt-text no-underline">
          <Tile icon={<PiCloudFill size={18} />} />
          <span className="flex-1 text-sm font-bold">Manage in Gryt Cloud</span>
          <PiArrowSquareOutBold size={14} className="text-gryt-muted" aria-label="Opens in your browser" />
        </a>
      </Surface>
    </div>
  );
}

function Tile({ icon }: { icon: React.ReactNode }) {
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: 36, height: 36, borderRadius: "var(--gryt-radius-md)", background: "var(--gryt-accent-a3)", color: "var(--gryt-accent-11)" }}>
      {icon}
    </span>
  );
}
