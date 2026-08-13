import { motion } from "motion/react";

interface SkeletonBaseProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const SkeletonBase = ({ 
  width = "100%", 
  height = "1rem", 
  borderRadius = "var(--gryt-radius-sm)",
  className,
  style 
}: SkeletonBaseProps) => {
  return (
    <motion.div
      className={className}
      style={{
        width,
        height,
        borderRadius,
        background: "var(--gryt-neutral-3)",
        ...style,
      }}
      animate={{
        opacity: [0.5, 1, 0.5],
      }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
};
