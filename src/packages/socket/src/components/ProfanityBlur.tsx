import { memo, useCallback, useState } from "react";
import { Tooltip } from "@radix-ui/themes";

import type { ProfanityMatchRange } from "./chatUtils";

interface ProfanityBlurProps {
  text: string;
  matches: ProfanityMatchRange[];
  blurEnabled: boolean;
}

export const BlurredWord = ({ word }: { word: string }) => {
  const [revealed, setRevealed] = useState(false);

  const toggle = useCallback(() => setRevealed((r) => !r), []);

  if (revealed) {
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggle(); }}
        style={{
          color: "var(--red-11)",
          cursor: "pointer",
          borderBottom: "1px dotted var(--red-8)",
        }}
      >
        {word}
      </span>
    );
  }

  return (
    <Tooltip content="Click to reveal" delayDuration={200}>
      <span
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggle(); }}
        style={{
          filter: "blur(4px)",
          WebkitFilter: "blur(4px)",
          userSelect: "none",
          cursor: "pointer",
          background: "var(--gray-5)",
          borderRadius: "var(--radius-2)",
          padding: "0 2px",
          transition: "filter 0.2s",
        }}
        aria-label="Blurred profanity — click to reveal"
      >
        {word}
      </span>
    </Tooltip>
  );
};

function mergeOverlapping(matches: ProfanityMatchRange[]): ProfanityMatchRange[] {
  if (matches.length <= 1) return matches;
  const sorted = [...matches].sort((a, b) => a.startIndex - b.startIndex);
  const merged: ProfanityMatchRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.startIndex <= prev.endIndex + 1) {
      prev.endIndex = Math.max(prev.endIndex, cur.endIndex);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

export const ProfanityBlurText = memo(({ text, matches, blurEnabled }: ProfanityBlurProps) => {
  if (!blurEnabled || matches.length === 0) {
    return <>{text}</>;
  }

  const merged = mergeOverlapping(matches);
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const m of merged) {
    const start = Math.max(0, m.startIndex);
    const end = Math.min(text.length, m.endIndex + 1);
    if (start > cursor) {
      parts.push(<span key={`t-${cursor}`}>{text.slice(cursor, start)}</span>);
    }
    parts.push(<BlurredWord key={`b-${start}`} word={text.slice(start, end)} />);
    cursor = end;
  }

  if (cursor < text.length) {
    parts.push(<span key={`t-${cursor}`}>{text.slice(cursor)}</span>);
  }

  return <>{parts}</>;
});

ProfanityBlurText.displayName = "ProfanityBlurText";
