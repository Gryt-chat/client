import { Flex, Text } from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";

import { Logo } from "@/common";

import { isElectron } from "../lib/electron";
import { TITLEBAR_HEIGHT } from "./titlebar";

export function AuthLoadingOverlay({
  open,
  fadeDurationMs = 450,
}: {
  open: boolean;
  fadeDurationMs?: number;
}) {
  const titlebarHeight = isElectron() ? TITLEBAR_HEIGHT : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="auth-loading-overlay"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: fadeDurationMs / 1000, ease: "easeInOut" }}
          style={{
            position: "fixed",
            top: titlebarHeight,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999999,
            background: "var(--color-background)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "all",
            userSelect: "none",
          }}
          role="status"
          aria-label="Verifying sign-in status"
          aria-live="polite"
          aria-busy="true"
        >
          <Flex direction="column" align="center" justify="center" gap="4">
            <Logo />

            <Flex direction="column" align="center" gap="2">
              <motion.div
                aria-label="Loading"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  border: "3px solid var(--gray-a5)",
                  borderTopColor: "var(--accent-9)",
                  boxSizing: "border-box",
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
              />
              <Text size="2" color="gray">
                Verifying…
              </Text>
            </Flex>
          </Flex>

          <Text
            size="1"
            color="gray"
            style={{
              position: "absolute",
              bottom: 12,
              left: 16,
              fontFamily: "var(--code-font-family)",
              opacity: 0.5,
            }}
          >
            v{__APP_VERSION__}
          </Text>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

