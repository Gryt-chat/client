import { Button, Chip, type ChipProps, Dialog } from "@gryt/ui";
import { Fragment } from "react";

import { LogoIcon } from "@/common";

export interface WhatsNewChange {
  kind: string;
  text: string;
}

/**
 * The order the groups are drawn in, which is not the order they are written in.
 * Security leads wherever it appears: below the features it is what gets skipped.
 */
const KIND_ORDER = ["security", "new", "changed", "fixed"];

const LABELS: Record<string, string> = {
  new: "New",
  fixed: "Fixed",
  changed: "Changed",
  security: "Security",
};

/**
 * The two kinds that decide whether somebody reads this or presses Done. The
 * rest, and a kind this build cannot name, stay neutral.
 */
const TONES: Record<string, ChipProps["tone"]> = {
  new: "primary",
  security: "warning",
};

/**
 * The changes by kind, in KIND_ORDER, with anything the site has started
 * emitting that this build does not know about kept on the end.
 */
function group(changes: WhatsNewChange[]): [string, string[]][] {
  const kinds = [...new Set(changes.map((c) => c.kind))];
  const ordered = [
    ...KIND_ORDER.filter((k) => kinds.includes(k)),
    ...kinds.filter((k) => !KIND_ORDER.includes(k)),
  ];

  return ordered.map((kind) => [
    kind,
    changes.filter((c) => c.kind === kind).map((c) => c.text),
  ]);
}

/**
 * The day and month, in the reader's locale. From the parts, because
 * `new Date("2026-09-08")` is UTC midnight and reads as the 7th in the Americas.
 */
function readableDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
  });
}

/**
 * What a release changed, the first time somebody opens it. The third dialog
 * this app draws, and the only one with a shape ConfirmDialog cannot carry.
 */
export function WhatsNewDialog({
  version,
  date,
  line,
  changes,
  onClose,
}: {
  version: string;
  date: string;
  line: string;
  changes?: WhatsNewChange[];
  onClose: () => void;
}) {
  /* Releases before 1.10 carry a line and no kinds, so there is nothing to
     group. Their one sentence is shown as it is written. */
  const groups = changes?.length ? group(changes) : null;

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup
          /* A container, so the groups collapse on the card's width rather
             than the window's. The width is explicit, so nothing depends on it. */
          style={{
            containerType: "inline-size",
            display: "flex",
            flexDirection: "column",
            gap: 0,
            /* The body scrolls inside this, so the greeting and Done stay put.
               A note long enough to run off the screen took Done with it. */
            maxHeight: "min(38rem, calc(100vh - 4rem))",
            overflow: "hidden",
            padding: 0,
            width: "min(28.75rem, calc(100vw - 3rem))",
          }}
        >
          <div className="whats-new-pad">
            <div className="whats-new-head">
              <span className="whats-new-mark">
                <LogoIcon size={26} />
              </span>
              <span>
                <Dialog.Title className="whats-new-greet">
                  Here&rsquo;s what&rsquo;s new in Gryt Chat
                </Dialog.Title>
                <p className="whats-new-meta">
                  {version} · {readableDate(date)}
                </p>
              </span>
            </div>

            {groups ? (
              <dl className="whats-new-groups">
                {groups.map(([kind, items]) => (
                  <Fragment key={kind}>
                    <dt>
                      <Chip tone={TONES[kind] ?? "neutral"}>{LABELS[kind] ?? kind}</Chip>
                    </dt>
                    <dd>
                      {items.map((text) => (
                        <p key={text}>{text}</p>
                      ))}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            ) : (
              <p className="whats-new-plain">{line}</p>
            )}
          </div>

          <div className="whats-new-foot">
            <a
              className="gryt-link whats-new-link"
              href={`https://gryt.chat/changelog/${version}`}
              target="_blank"
              rel="noreferrer"
            >
              Read more
            </a>
            <Dialog.Close render={<Button size="small">Done</Button>} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
