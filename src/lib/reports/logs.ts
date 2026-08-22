/**
 * The tail of the renderer's own log, kept so a bug report can carry it.
 *
 * This is the field a round trip through a GitHub issue form cannot produce.
 * Somebody reporting that voice dropped has the reason in their console —
 * an ICE failure, a track that never arrived, a socket that closed — and no
 * reasonable way to get it out of the app and into a form.
 *
 * ## What it keeps
 *
 * The last few hundred lines, in memory, never written to disk. `warn` and
 * `error` only: the client logs a great deal at `log` level, and a buffer full
 * of routine chatter pushes out the one line that mattered.
 *
 * ## What it does not keep
 *
 * Nothing is redacted here, so nothing sensitive should be logged in the first
 * place — which is already true and is worth keeping true. The report form
 * shows how many lines are attached before it sends, and the lines themselves
 * go nowhere until somebody presses send.
 */

const MAX_LINES = 300;
const MAX_LINE_CHARS = 500;

const lines: string[] = [];

/**
 * Drop the styling from a `console.warn("%cthing", "color:…")` call.
 *
 * The voice layer logs almost everything this way, and without this every line
 * in the buffer arrives wearing a CSS declaration — which is most of its
 * length and none of its meaning, in the one field a bug report exists to
 * carry.
 */
function unstyle(args: unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (typeof first !== "string" || !first.includes("%c")) return args;

  const styles = (first.match(/%c/g) ?? []).length;
  return [first.replace(/%c/g, ""), ...rest.slice(styles)];
}

function record(level: "warn" | "error", args: unknown[]): void {
  const text = unstyle(args)
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        // A circular object, a Proxy, a DOM node. Its type is more use than a
        // thrown TypeError from inside the logger.
        return Object.prototype.toString.call(a);
      }
    })
    .join(" ");

  const stamped = `${new Date().toISOString()} ${level} ${text}`;
  lines.push(
    stamped.length > MAX_LINE_CHARS ? `${stamped.slice(0, MAX_LINE_CHARS)}…` : stamped,
  );
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

let installed = false;

/**
 * Start recording. Called once, as early as `main.tsx` can manage.
 *
 * Wraps rather than replaces, so the console still shows everything it did
 * before — a devtools session that stopped printing warnings because of a bug
 * reporter would be a bad trade.
 */
export function captureLogs(): void {
  if (installed) return;
  installed = true;

  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        record(level, args);
      } catch {
        // Never let the recorder break the thing it is recording.
      }
      original(...args);
    };
  }
}

/** What a report attaches. A copy, so it cannot change under the sender. */
export function recentLogs(): string[] {
  return [...lines];
}
