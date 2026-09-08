import { useSyncExternalStore } from "react";

import { shownPanels, subscribePanels } from "@/addons";

/**
 * What plugins have asked to show, drawn under the member list. **Nothing is
 * markup**, and **the plugin's name is beside the title, not optional** (GRYT-951).
 */
export const PluginPanels = () => {
  const panels = useSyncExternalStore(subscribePanels, shownPanels, shownPanels);

  if (panels.length === 0) return null;

  return (
    <>
      {panels.map(({ addonId, addonName, panel }) => (
        <section
          key={addonId}
          data-gryt="plugin-panel"
          data-addon={addonId}
          aria-labelledby={`plugin-panel-${addonId}`}
          className="mt-4"
        >
          {/* Sticky like a role heading, and for the same reason: a list you
              have scrolled into wants to keep saying whose it is. */}
          <h3
            id={`plugin-panel-${addonId}`}
            className="text-xs font-bold uppercase tracking-wide text-gryt-muted"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 1,
              background: "var(--gryt-neutral-3)",
              padding: "2px 4px 6px",
              margin: 0,
            }}
          >
            {panel.title}
            {/* Not uppercase and not bold, so it reads as attribution rather
                than as part of the title the plugin chose. */}
            <span className="block font-medium normal-case tracking-normal text-gryt-muted opacity-70">
              {addonName}
            </span>
          </h3>

          {panel.rows.length === 0 ? (
            <p className="px-1 py-1 text-xs text-gryt-muted opacity-70">Nothing to show.</p>
          ) : (
            <ul className="flex flex-col gap-1 m-0 p-0 list-none">
              {panel.rows.map((row, index) => (
                <li
                  /* The index, because a plugin's rows have no id and two may
                     read the same. The list is replaced whole on every update. */
                  key={index}
                  className="flex items-baseline gap-2 px-1 py-0.5 text-sm"
                  style={{ minWidth: 0 }}
                >
                  <span className="truncate" style={{ flex: "0 1 auto", minWidth: 0 }}>
                    {row.label}
                  </span>
                  {row.value && (
                    <span
                      className="truncate text-xs text-gryt-muted"
                      style={{ flex: "1 1 auto", minWidth: 0, textAlign: "right" }}
                    >
                      {row.value}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
};
