import { motion, useDragControls } from "motion/react";
import { ReactNode,useRef } from "react";

interface DebugOverlayProps {
  isVisible: boolean;
  title: string;
  icon: string;
  status: {
    active: boolean;
    label: string;
  };
  children: ReactNode;
  initialPosition?: {
    x: number;
    y: number;
  };
}

export function DebugOverlay({ 
  isVisible, 
  title, 
  icon, 
  status, 
  children,
  initialPosition = { x: window.innerWidth - 340, y: 10 }
}: DebugOverlayProps) {
  // Drag functionality
  const dragControls = useDragControls();
  const constraintsRef = useRef<HTMLDivElement>(null);

  if (!isVisible) return null;

  return (
    <div ref={constraintsRef} style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
      <motion.div
        drag
        dragControls={dragControls}
        dragConstraints={constraintsRef}
        dragElastic={0.2}
        dragMomentum={true}
        initial={{ 
          x: initialPosition.x, 
          y: initialPosition.y,
          scale: 0.8,
          opacity: 0
        }}
        animate={{ 
          x: initialPosition.x, 
          y: initialPosition.y,
          scale: 1,
          opacity: 1
        }}
        exit={{ 
          scale: 0.8,
          opacity: 0
        }}
        transition={{ 
          type: "spring", 
          stiffness: 300, 
          damping: 10,
          opacity: { duration: 0.3 }
        }}
        whileDrag={{ 
          scale: 1.05,
          boxShadow: "0 8px 24px var(--gryt-neutral-a8)"
        }}
        whileHover={{
          scale: 1.02,
          boxShadow: "0 6px 16px var(--gryt-neutral-a7)"
        }}
        style={{
          position: "absolute",
          width: "320px",
          backgroundColor: "var(--gryt-neutral-a3)",
          color: "var(--gryt-neutral-12)",
          fontFamily: "var(--code-font-family)",
          fontSize: "12px",
          padding: "12px",
          borderRadius: "var(--gryt-radius-md)",
          border: "1px solid var(--gryt-neutral-7)",
          zIndex: "var(--gryt-z-debug)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 4px 12px var(--gryt-neutral-a6)",
          cursor: "grab",
          pointerEvents: "auto",
          userSelect: "none",
        }}
      >
        {/* Header */}
        <div 
          style={{ 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center",
            marginBottom: "8px",
            borderBottom: "1px solid var(--gryt-neutral-7)",
            paddingBottom: "6px",
            cursor: "grab",
            userSelect: "none"
          }}
          onPointerDown={(e) => dragControls.start(e)}
        >
          <h3 style={{ margin: 0, color: "var(--gryt-success-11)" }}>{icon} {title}</h3>
          <div style={{ fontSize: "10px", color: "var(--gryt-neutral-9)", display: "flex", alignItems: "center", gap: "4px" }}>
            <span>⋮⋮</span>
            {status.active ? "🟢 Active" : "🔴 Inactive"} - {status.label}
          </div>
        </div>

        {/* Content */}
        {children}
      </motion.div>
    </div>
  );
}