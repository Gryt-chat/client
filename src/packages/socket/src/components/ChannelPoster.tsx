import type { ChannelPoster as Poster } from "@/settings/src/types/server";

import { PiChatTeardropTextFill } from "../../../../lib/icons";
import { usePosterVars } from "../hooks/usePosterVars";
import { EmojiText } from "./EmojiText";

/** The top of a channel's history, drawn from the same card variables as a member card. */
export function ChannelPoster({ poster, channelName, topic, serverName }: {
  poster: Poster;
  channelName: string;
  topic?: string;
  serverName?: string;
}) {
  const vars = usePosterVars(poster, channelName);
  const label = serverName ? `${serverName} · start of the channel` : "Start of the channel";

  if (poster.layout === "quiet") {
    return (
      <section
        aria-label={`Start of ${channelName}`}
        className="mx-4 mt-4 mb-6 flex flex-col gap-2 rounded-(--gryt-radius-lg) bg-gryt-neutral-2 px-6 py-8"
        style={{ borderLeft: `6px solid ${poster.c1 ?? "var(--gryt-accent-9)"}` }}
      >
        <h2 className="m-0 flex items-center gap-3 text-3xl font-extrabold tracking-tight" style={{ overflowWrap: "anywhere" }}>
          <PiChatTeardropTextFill size={28} style={{ color: poster.c1 ?? "var(--gryt-accent-9)", flexShrink: 0 }} />
          <EmojiText text={channelName} />
        </h2>
        {topic && <p className="m-0 text-base text-gryt-muted">{topic}</p>}
      </section>
    );
  }

  const centred = poster.layout === "centred";
  return (
    <section
      aria-label={`Start of ${channelName}`}
      className="relative mx-4 mt-4 mb-6 overflow-hidden rounded-(--gryt-radius-lg)"
      style={{ ...vars, minHeight: 220, background: "var(--poster-bg, var(--gryt-accent-9))" }}
    >
      <div aria-hidden className="absolute inset-0" style={{ backgroundImage: "var(--pat-img, none)", backgroundSize: "cover" }} />
      <div
        className={`relative flex h-full min-h-[220px] flex-col gap-3 px-8 py-8 ${centred ? "items-center justify-center text-center" : "justify-end"}`}
        style={{ color: "var(--gryt-text, #fff)" }}
      >
        <span className="text-xs font-bold uppercase" style={{ letterSpacing: "0.08em", opacity: 0.85 }}>{label}</span>
        <h2 className="m-0 font-extrabold leading-none" style={{ fontSize: "clamp(36px, 6vw, 64px)", letterSpacing: "-0.03em", overflowWrap: "anywhere" }}>
          <EmojiText text={channelName} />
        </h2>
        {centred && <span aria-hidden className="h-[3px] w-10 rounded-full" style={{ background: "currentColor", opacity: 0.6 }} />}
        {topic && <p className="m-0 text-base" style={{ opacity: 0.88, maxWidth: "52ch" }}>{topic}</p>}
      </div>
    </section>
  );
}
