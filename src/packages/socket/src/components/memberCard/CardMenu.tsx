import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { CardIcon } from "./cardIcons";

export interface CardMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** Draws a tick slot, for toggles like a role held or not. */
  checked?: boolean;
  /** A rule above this item. */
  divider?: boolean;
}

/**
 * An icon button with its menu drawn inside the card, so the menu takes the card's
 * colours. Escape and a click outside close it; arrows move between items.
 */
export function CardMenu({
  className,
  tip,
  label,
  icon,
  items,
  align = "right",
  onOpenChange,
}: {
  className: string;
  tip: string;
  label?: ReactNode;
  icon: ReactNode;
  items: CardMenuItem[];
  align?: "left" | "right";
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const hasChecks = items.some((item) => item.checked !== undefined);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    wrap.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => document.removeEventListener("pointerdown", outside, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = Array.from(wrap.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
    list[next]?.focus();
  };

  return (
    <span ref={wrap} style={{ display: "inline-flex" }} onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={tip}
        data-tip={tip}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {icon}
        {label}
      </button>
      {open && (
        <div id={id} className={align === "left" ? "gmc-menu gmc-pop left" : "gmc-menu gmc-pop"} role="menu" aria-label={tip}>
          {items.map((item) => (
            <span key={item.key} style={{ display: "contents" }}>
              {item.divider && <hr />}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={item.danger ? "mi danger" : "mi"}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {hasChecks && <span style={{ width: 14, display: "inline-grid" }}>{item.checked ? <CardIcon.check /> : null}</span>}
                  {item.label}
                </span>
              </button>
            </span>
          ))}
        </div>
      )}
    </span>
  );
}
