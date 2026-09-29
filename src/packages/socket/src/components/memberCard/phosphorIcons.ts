/**
 * Every Phosphor icon, each in its own chunk. This module is itself loaded on demand,
 * so the card and the main bundle only ever carry the icons somebody picked.
 */

import type { CardIconModule } from "@gryt/ui";
import type { ReactElement, ReactNode } from "react";

type PatternMark = NonNullable<Awaited<ReturnType<CardIconModule["loadIconMark"]>>>;

const DEFS = import.meta.glob<{ default: Map<string, ReactElement> }>("/node_modules/@phosphor-icons/react/dist/defs/*.es.js");

/** "FlyingSaucer" as it is stored: "flying-saucer". */
export function kebab(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .toLowerCase();
}

const BY_NAME = new Map(
  Object.keys(DEFS).map((path) => [kebab(path.slice(path.lastIndexOf("/") + 1).replace(".es.js", "")), path]),
);

export const ICON_NAMES: readonly string[] = [...BY_NAME.keys()].sort();

const attr = (key: string) => (key === "className" ? "class" : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A React element tree as SVG markup. Phosphor's defs are plain paths, lines and circles. */
function markup(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(markup).join("");
  if (typeof node === "string" || typeof node === "number") return esc(node);
  const el = node as ReactElement<Record<string, unknown>>;
  const { children, ...props } = el.props ?? {};
  if (typeof el.type !== "string") return markup(children as ReactNode);
  const attrs = Object.entries(props)
    .filter(([, v]) => v !== undefined && v !== null && typeof v !== "object" && typeof v !== "function")
    .map(([k, v]) => ` ${attr(k)}="${esc(v)}"`)
    .join("");
  return `<${el.type}${attrs}>${markup(children as ReactNode)}</${el.type}>`;
}

const cache = new Map<string, Promise<PatternMark | null>>();

/** The icon in its regular weight, ready to strew, or null for a name this build lacks. */
export function loadIconMark(name: string): Promise<PatternMark | null> {
  const hit = cache.get(name);
  if (hit) return hit;
  const path = BY_NAME.get(name);
  const load = path
    ? DEFS[path]().then((m) => {
        const regular = m.default.get("regular");
        return regular ? { viewBox: "0 0 256 256", body: markup(regular), mono: true } : null;
      })
    : Promise.resolve(null);
  cache.set(name, load);
  return load;
}
