import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

type Side = "left" | "right" | "bottom";

interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  side: Side;
  children: ReactNode;
  width?: string;
  height?: string;
}

const sideStyles: Record<Side, { position: Record<string, string | number>; axis: "x" | "y"; closedValue: string }> = {
  left: {
    position: { top: 0, left: 0, bottom: 0 },
    axis: "x",
    closedValue: "-100%",
  },
  right: {
    position: { top: 0, right: 0, bottom: 0 },
    axis: "x",
    closedValue: "100%",
  },
  bottom: {
    position: { left: 0, right: 0, bottom: 0 },
    axis: "y",
    closedValue: "100%",
  },
};

export const MobileSheet = ({ open, onClose, side, children, width, height }: MobileSheetProps) => {
  const config = sideStyles[side];

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  const defaultSize =
    side === "bottom"
      ? { width: "100%", height: height ?? "75vh" }
      : { width: width ?? "280px", height: "100%" };

  const initial = config.axis === "x"
    ? { x: config.closedValue, opacity: 1 }
    : { y: config.closedValue, opacity: 1 };

  const animate = config.axis === "x" ? { x: 0 } : { y: 0 };
  const exit = initial;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              zIndex: 1000,
            }}
          />
          <motion.div
            key="sheet-content"
            initial={initial}
            animate={animate}
            exit={exit}
            transition={{ type: "spring", stiffness: 400, damping: 36 }}
            style={{
              position: "fixed",
              ...config.position,
              ...defaultSize,
              zIndex: 1001,
              background: "var(--color-background)",
              boxShadow: "0 0 24px rgba(0,0,0,0.3)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              ...(side === "bottom" && { borderTopLeftRadius: 12, borderTopRightRadius: 12 }),
            }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
};
