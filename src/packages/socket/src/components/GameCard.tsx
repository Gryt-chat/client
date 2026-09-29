import { useEffect, useState } from "react";

import type { RichActivity } from "../../../../lib/richActivity";
import { buttonLink, cardHeading, elapsed, partyText } from "../lib/gameCard";
import { GameIcon } from "./GameIcon";

/** A game's Rich Presence on somebody's member card: what, where, for how long, and its icon. */
export function GameCard({ card }: { card: RichActivity }) {
  const [now, setNow] = useState(() => Date.now());

  // Only while there's a timer to move, and only while the card is open.
  useEffect(() => {
    if (card.startedAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [card.startedAt]);

  const time = elapsed(card.startedAt, now);
  const party = partyText(card.party);
  const links = (card.buttons ?? [])
    .map((button) => ({ label: button.label, link: buttonLink(button.url) }))
    .filter((b): b is { label: string; link: { href: string; host: string } } => b.link !== null);

  return (
    <section
      aria-label={`${cardHeading(card)} ${card.name}`}
      className="flex min-w-0 flex-col gap-1 rounded-(--gryt-radius-sm) border border-gryt-border bg-gryt-bg px-2.5 py-2"
    >
      <span className="text-xs font-semibold text-gryt-muted">{cardHeading(card)}</span>
      <div className="flex min-w-0 items-center gap-2">
        <GameIcon appId={card.appId} name={card.name} size={32} />
        <span className="min-w-0 text-sm font-bold text-gryt-text" style={{ overflowWrap: "anywhere" }}>
          {card.name}
        </span>
      </div>
      {card.details && (
        <span className="text-xs text-gryt-text" style={{ overflowWrap: "anywhere" }}>
          {card.details}
        </span>
      )}
      {(card.state || party) && (
        <span className="text-xs text-gryt-text" style={{ overflowWrap: "anywhere" }}>
          {[card.state, party].filter(Boolean).join(" · ")}
        </span>
      )}
      {time && (
        <span className="text-xs tabular-nums text-gryt-muted">
          <time dateTime={new Date(card.startedAt ?? now).toISOString()}>{time}</time> elapsed
        </span>
      )}
      {links.length > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          {links.map(({ label, link }) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              title={link.href}
              className="flex min-w-0 items-baseline justify-between gap-2 rounded-(--gryt-radius-sm) border border-gryt-border px-2 py-1 text-xs font-semibold text-gryt-text no-underline hover:bg-gryt-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <span className="shrink-0">{label}</span>
              {/* Where it goes, since the game chose the label and the link. */}
              <span className="min-w-0 truncate font-normal text-gryt-muted">{link.host}</span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
