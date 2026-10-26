import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties } from "react";

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
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  transformOrigin: "left bottom",
};

// Frosted over a camera, so the face behind it stays visible.
const GLASS: CSSProperties = {
  background: "rgba(20,22,30,.62)",
  color: "#ffffff",
  border: "1px solid rgba(255,255,255,.18)",
  backdropFilter: "blur(8px)",
};

/** What a person in the call just typed, popping from their tile; the newest is the loudest. */
export function CallBubbles({ bubbles, typing, glass }: { bubbles: CallBubble[]; typing: boolean; glass: boolean }) {
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
              animate={{ opacity: old ? 0.55 : 1, scale: old ? 0.94 : 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              style={{ ...BUBBLE, ...(glass ? GLASS : null) }}
            >
              <EmojiText text={b.text} />
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
