import { Button, Chip, type ChipProps, Dialog } from "@gryt/ui";

import { LogoIcon } from "@/common";

export interface WhatsNewChange {
  kind: string;
  text: string;
}

export interface WhatsNewRelease {
  version: string;
  date: string;
  line: string;
  changes?: WhatsNewChange[];
}

/**
 * The order the kinds are drawn in, which is not the order they are written in.
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
 * The changes in KIND_ORDER, as written within a kind, with anything the site
 * has started emitting that this build does not know about kept on the end.
 */
function ordered(changes: WhatsNewChange[]): WhatsNewChange[] {
  const kinds = [...new Set(changes.map((c) => c.kind))];
  const order = [
    ...KIND_ORDER.filter((k) => kinds.includes(k)),
    ...kinds.filter((k) => !KIND_ORDER.includes(k)),
  ];

  return order.flatMap((kind) => changes.filter((c) => c.kind === kind));
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

/** One release's changes, a pill on each, or its one sentence where it was never split. */
function ReleaseBody({ line, changes }: { line: string; changes?: WhatsNewChange[] }) {
  /* Releases before 1.10 carry a line and no kinds, so there is nothing to
     label. Their one sentence is shown as it is written. */
  if (!changes?.length) return <p className="whats-new-plain">{line}</p>;

  return (
    <ul className="whats-new-changes">
      {ordered(changes).map((change, i) => (
        <li key={i} className="whats-new-change">
          <Chip className="whats-new-kind" tone={TONES[change.kind] ?? "neutral"}>
            {LABELS[change.kind] ?? change.kind}
          </Chip>
          <p>{change.text}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * What changed since somebody last opened Gryt, newest release first. The third
 * dialog this app draws, and the only one with a shape ConfirmDialog cannot carry.
 */
export function WhatsNewDialog({
  releases,
  since,
  capped,
  onClose,
}: {
  releases: WhatsNewRelease[];
  since: string | null;
  capped: boolean;
  onClose: () => void;
}) {
  const [newest] = releases;
  const several = releases.length > 1;

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
          /* A container, so the pills stack on the card's width rather than
             the window's. The width is explicit, so nothing depends on it. */
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
                  {several && since ? (
                    <>What&rsquo;s new since {since}</>
                  ) : (
                    <>Here&rsquo;s what&rsquo;s new in Gryt Chat</>
                  )}
                </Dialog.Title>
                <p className="whats-new-meta">
                  {!several
                    ? `${newest.version} · ${readableDate(newest.date)}`
                    : capped
                      ? `The ${releases.length} newest releases`
                      : `${releases.length} releases`}
                </p>
              </span>
            </div>

            {several ? (
              <div className="whats-new-releases">
                {releases.map((release) => (
                  <section key={release.version} className="whats-new-release">
                    <h3 className="whats-new-version">
                      {release.version} · {readableDate(release.date)}
                    </h3>
                    <ReleaseBody line={release.line} changes={release.changes} />
                  </section>
                ))}
              </div>
            ) : (
              <ReleaseBody line={newest.line} changes={newest.changes} />
            )}
          </div>

          <div className="whats-new-foot">
            <a
              className="gryt-link whats-new-link"
              href={several ? "https://gryt.chat/changelog" : `https://gryt.chat/changelog/${newest.version}`}
              target="_blank"
              rel="noreferrer"
            >
              {several ? "Full changelog" : "Read more"}
            </a>
            <Dialog.Close render={<Button size="small">Done</Button>} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
