import { AnimatePresence, motion } from "motion/react";
import { type CSSProperties, useState } from "react";

import { PiHeartFill } from "../../../../lib/icons";
import type { CallBubble } from "../hooks/useCallBubbles";
import { EmojiText } from "./EmojiText";

const BUBBLE: CSSProperties = {
  maxWidth: "88%",
  background: "#f4f3ff",
  color: "#16151f",
  borderRadius: "16px 16px 16px 4px",
  padding: "8px 12px",
  fontSize: 14,
  fontWeight: 600,
  boxShadow: "0 10px 28px rgba(0,0,0,.4)",
  overflowWrap: "anywhere",
  position: "relative",
};

const CLAMP: CSSProperties = { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" };

export type BubbleAction = "reply" | "react" | "open";

const ACTS: { kind: BubbleAction; label: string }[] = [
  { kind: "reply", label: "Reply" },
  { kind: "react", label: "React" },
  { kind: "open", label: "Open in chat" },
];

// Frosted over a camera, so the face behind it stays visible.
const GLASS: CSSProperties = {
  background: "rgba(20,22,30,.62)",
  color: "#ffffff",
  border: "1px solid rgba(255,255,255,.18)",
  backdropFilter: "blur(8px)",
};

/** What a person in the call just typed, popping from their tile; the newest is the loudest. */
export function CallBubbles({ bubbles, typing, glass, onAction }: {
  bubbles: CallBubble[];
  typing: boolean;
  glass: boolean;
  onAction?: (kind: BubbleAction, messageId: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  if (!bubbles.length && !typing) return null;
  return (
    <div
      className="pointer-events-none absolute flex flex-col items-start gap-1.5"
      style={{ left: 14, top: 14, right: 14, zIndex: 3 }}
    >
      <AnimatePresence initial={false}>
        {bubbles.map((b, i) => {
          const old = i < bubbles.length - 1;
          return (
            <motion.div
              key={b.id}
              layout
              initial={{ opacity: 0, scale: 0.8, y: 8 }}
              animate={{ opacity: old && hovered !== b.id ? 0.55 : 1, scale: old ? 0.94 : 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className={onAction ? "pointer-events-auto" : undefined}
              style={{ maxWidth: "88%", transformOrigin: "left bottom" }}
              onPointerEnter={() => setHovered(b.id)}
              onPointerLeave={() => setHovered((h) => (h === b.id ? null : h))}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div style={{ ...BUBBLE, maxWidth: "100%", ...(glass ? GLASS : null) }}>
                {b.quote && (
                  <div
                    className="mb-1 truncate pl-1.5 text-[11px] font-bold"
                    style={{ color: glass ? "rgba(255,255,255,.75)" : "#6360a0", borderLeft: "2px solid var(--gryt-accent)" }}
                  >
                    <EmojiText text={b.quote} />
                  </div>
                )}
                <div style={CLAMP}><EmojiText text={b.text} /></div>
                {!!b.reactions?.length && (
                  <span
                    className="absolute flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold"
                    style={{ right: -8, bottom: -12, background: "#242439", color: "#e3e4ff", border: "1px solid #3c3a64" }}
                  >
                    {b.reactions.map((r) => (
                      <span key={r.src} className="flex items-center gap-0.5">
                        <EmojiText text={r.src} emojiSize={11} disableTooltip />
                        {r.amount}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              {onAction && hovered === b.id && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {ACTS.map((a) => (
                    <button
                      key={a.kind}
                      type="button"
                      className="flex h-7 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-bold"
                      style={{ background: "#1a1d24", border: "1px solid #2b303d", color: "#e0e0e6" }}
                      onClick={() => onAction(a.kind, b.id)}
                    >
                      {a.kind === "react" && <PiHeartFill size={11} color="#f87171" />}
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
        {typing && (
          <motion.div
            key="typing"
            layout
            role="status"
            aria-label="Typing"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex gap-1"
            style={{ background: "#f4f3ff", borderRadius: "14px 14px 14px 4px", padding: "10px 12px", ...(glass ? GLASS : null) }}
          >
            {[1, 0.7, 0.45].map((o, i) => (
              <motion.span
                key={o}
                className="h-[7px] w-[7px] rounded-full"
                style={{ background: glass ? "#ffffff" : "#6360a0", opacity: o }}
                animate={{ y: [0, -3, 0] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
