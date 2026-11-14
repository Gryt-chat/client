/**
 * The last five minutes of the renderer's own log, so a bug report can carry it. **Nothing is
 * redacted, and this is off unless the reporter ticks the box.**
 */

export const WINDOW_MS = 5 * 60 * 1000;
const MAX_LINES = 2000;
const MAX_LINE_CHARS = 500;
export const MAX_CHARS = 100_000;

const lines: { at: number; text: string }[] = [];

/**
 * Drop the styling from a `console.warn("%cthing", "color:…")` call. The voice
 * layer logs almost everything that way, and the CSS is most of the length.
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

  const at = Date.now();
  const stamped = `${new Date(at).toISOString()} ${level} ${text}`;
  lines.push({
    at,
    text: stamped.length > MAX_LINE_CHARS ? `${stamped.slice(0, MAX_LINE_CHARS)}…` : stamped,
  });
  while (lines.length > MAX_LINES || lines[0].at < at - WINDOW_MS) lines.shift();
}

let installed = false;

/**
 * Start recording. Called once, as early as `main.tsx` can manage. Wraps rather
 * than replaces, so the console still shows everything it did before.
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

/** The last `windowMs` of lines, newest kept first when `maxChars` cuts. */
export function windowLines(
  entries: { at: number; text: string }[],
  now: number,
  windowMs = WINDOW_MS,
  maxChars = MAX_CHARS,
): string[] {
  const out: string[] = [];
  let size = 0;
  for (let i = entries.length - 1; i >= 0 && entries[i].at >= now - windowMs; i--) {
    size += entries[i].text.length + 1;
    if (size > maxChars) break;
    out.unshift(entries[i].text);
  }
  return out;
}

/** What a report attaches. A copy, so it cannot change under the sender. */
export function recentLogs(): string[] {
  return windowLines(lines, Date.now());
}
