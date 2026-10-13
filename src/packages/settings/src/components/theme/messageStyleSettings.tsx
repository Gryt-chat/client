import type { CSSProperties, ReactNode } from "react";

import { type MessageStyle, type OwnMessageSide, useTheme } from "@/common";

import { SettingGroup, SettingsContainer } from "../settingsComponents";

/* The previews are drawn shapes, not real messages: they only need to show the layout. */
const bar = (width: number, color: string, height = 6): CSSProperties => ({
  width, height, borderRadius: 3, background: color, flex: "none",
});
const dot = (color: string): CSSProperties => ({ width: 16, height: 16, borderRadius: "50%", background: color, flex: "none" });

const OTHERS = ["#e58aa8", "#8cc0ea"];
const MINE = "#e8a96b";

function Preview({ style, side }: { style: MessageStyle; side: OwnMessageSide }) {
  const rows: { color: string; width: number; mine: boolean }[] = [
    { color: OTHERS[0], width: 110, mine: false },
    { color: MINE, width: 80, mine: true },
    { color: OTHERS[1], width: 130, mine: false },
  ];
  return (
    <div
      aria-hidden="true"
      className="flex flex-col"
      style={{ gap: style === "compact" ? 9 : 11, padding: 12, borderRadius: "var(--gryt-radius-md)", background: "var(--gryt-neutral-2)" }}
    >
      {rows.map((r, i) => {
        const right = r.mine && side === "right";
        if (style === "compact") {
          return (
            <div key={i} className="flex items-center" style={{ gap: 6, justifyContent: right ? "flex-end" : "flex-start" }}>
              <span style={bar(14, "var(--gryt-neutral-6)", 5)} />
              <span style={bar(22, r.color)} />
              <span style={bar(r.width, "var(--gryt-neutral-9)")} />
            </div>
          );
        }
        if (style === "bubbles") {
          return (
            <div key={i} className="flex items-center" style={{ gap: 8, justifyContent: right ? "flex-end" : "flex-start" }}>
              {!right && <span style={dot(r.color)} />}
              <span style={{ ...bar(r.width, r.mine ? "var(--gryt-accent-9)" : "var(--gryt-neutral-5)", 18), borderRadius: 8 }} />
            </div>
          );
        }
        return (
          <div key={i} className="flex" style={{ gap: 8, flexDirection: right ? "row-reverse" : "row" }}>
            <span style={dot(r.color)} />
            <span className="flex flex-col" style={{ gap: 4, alignItems: right ? "flex-end" : "flex-start" }}>
              <span style={bar(30, "var(--gryt-neutral-7)")} />
              <span style={bar(r.width, "var(--gryt-neutral-9)")} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Choice({ checked, onSelect, label, hint, children }: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className="flex flex-col text-left"
      style={{
        flex: "1 1 180px",
        gap: 10,
        padding: 10,
        cursor: "pointer",
        borderRadius: "var(--gryt-radius-lg)",
        border: `2px solid ${checked ? "var(--gryt-accent-9)" : "var(--gryt-neutral-5)"}`,
        background: "var(--gryt-neutral-3)",
        color: "inherit",
        font: "inherit",
      }}
    >
      {children}
      <span className="flex flex-col" style={{ gap: 2 }}>
        <span className="text-sm font-bold">{label}</span>
        <span className="text-xs text-gryt-muted">{hint}</span>
      </span>
    </button>
  );
}

/** How messages are drawn, and which side yours go on. Both only change this device. */
export function MessageStyleSettings() {
  const { messageStyle, setMessageStyle, ownMessageSide, setOwnMessageSide } = useTheme();

  const styles: { value: MessageStyle; label: string; hint: string }[] = [
    { value: "cozy", label: "Cozy", hint: "Pictures and names, like it's always been." },
    { value: "compact", label: "Compact", hint: "No pictures, one line per message." },
    { value: "bubbles", label: "Bubbles", hint: "Each message in its own bubble." },
  ];
  const sides: { value: OwnMessageSide; label: string; hint: string }[] = [
    { value: "left", label: "On the left", hint: "With everyone else's." },
    { value: "right", label: "On the right", hint: "Easier to spot what you said." },
  ];

  return (
    <SettingsContainer>
      <h2 className="text-lg">Messages</h2>

      <SettingGroup title="Message style" description="How messages look in channels and direct messages, on this device only.">
        <div role="radiogroup" aria-label="Message style" className="flex flex-wrap" style={{ gap: 12 }}>
          {styles.map((s) => (
            <Choice key={s.value} checked={messageStyle === s.value} onSelect={() => setMessageStyle(s.value)} label={s.label} hint={s.hint}>
              <Preview style={s.value} side={ownMessageSide} />
            </Choice>
          ))}
        </div>
      </SettingGroup>

      <SettingGroup title="Your messages" description="Where the messages you send sit. Everyone else's stay on the left.">
        <div role="radiogroup" aria-label="Your messages" className="flex flex-wrap" style={{ gap: 12 }}>
          {sides.map((s) => (
            <Choice key={s.value} checked={ownMessageSide === s.value} onSelect={() => setOwnMessageSide(s.value)} label={s.label} hint={s.hint}>
              <Preview style={messageStyle} side={s.value} />
            </Choice>
          ))}
        </div>
      </SettingGroup>
    </SettingsContainer>
  );
}
