import { Button } from "@gryt/ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import { PiCaretDownFill, PiCaretRightFill } from "../../../../lib/icons";
import { clearFiltered, type FilteredItem, filteredSummary, useFilteredContacts } from "../hooks/contactFilterStore";
import { useServerManagement } from "../hooks/useServerManagement";

/**
 * What the app held back against your contact settings (GRYT-1470). Quiet on
 * purpose: no badge, closed until opened, and gone once nothing is in it.
 */
export function FilteredContacts({ onOpen }: { onOpen: (item: FilteredItem) => void }) {
  const items = useFilteredContacts();
  const { servers } = useServerManagement();
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();
  if (items.length === 0) return null;

  const Caret = expanded ? PiCaretDownFill : PiCaretRightFill;

  return (
    <div data-gryt="dm-filtered" className="px-2 pb-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`Filtered, ${items.length}`}
        className={[
          "mt-2 flex w-full items-center gap-2 rounded-(--gryt-radius-md) px-2 py-1 text-left",
          "text-xs font-semibold tracking-wide transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gryt-accent-light",
          "text-gryt-muted hover:text-gryt-text active:text-gryt-text",
        ].join(" ")}
      >
        <span className="shrink-0">Filtered</span>
        <span aria-hidden="true" className="h-px min-w-2 flex-1 bg-gryt-border" />
        <span aria-hidden="true" data-gryt="dm-filtered-count" className="shrink-0 tabular-nums opacity-70">
          {items.length}
        </span>
        <Caret size={10} className="shrink-0" />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: reduceMotion ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: reduceMotion ? 1 : 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            className="flex flex-col gap-1 pt-1"
          >
            <p className="px-2 text-xs text-gryt-muted">
              Held back by your privacy settings. Nothing here made a sound or a badge.
            </p>
            {items.map((item) => (
              <Button
                key={`${item.host}|${item.conversationId}|${item.kind}`}
                tone="ghost"
                data-gryt="dm-filtered-item"
                style={{ width: "100%", justifyContent: "start", overflow: "hidden" }}
                onClick={() => onOpen(item)}
              >
                <span className="flex min-w-0 flex-col items-start">
                  <span className="truncate text-sm">{item.fromName || "Somebody"}</span>
                  <span className="truncate text-xs text-gryt-muted">
                    {filteredSummary(item)} &middot; {servers[item.host]?.name || item.host}
                  </span>
                </span>
              </Button>
            ))}
            <Button tone="ghost" size="small" onClick={clearFiltered} style={{ alignSelf: "start" }}>
              Clear
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
