import type { GrytAppearance, GrytTheme } from "@gryt/ui";

/**
 * The server view, at a tenth of size and with the text taken out.
 *
 * A row of colour swatches cannot answer the question people actually have,
 * which is what the app looks like wearing this. So this draws the real layout
 * — rail, channels, chat, members — in the theme's own colours, at its own
 * corner radius, with bars where the words go.
 *
 * Every measurement below came off the client rather than being chosen, and
 * they are scaled by one factor. That matters more than it sounds: the chat
 * avatar is 51px and the member avatar 32px, so drawing them the same size
 * makes the picture stop looking like Gryt even though the colours are right.
 *
 * The window it stands for is 1040x620 rather than a full-screen 1440. The two
 * sidebars are a fixed 240 either way, so on a smaller window they take more of
 * the frame, and that is what makes a 200px-wide picture legible instead of
 * four columns of grey.
 */

const REAL = {
  w: 1040,
  h: 620,
  pad: 16,
  gap: 16,
  rail: { w: 56, icon: 32, gap: 14, padY: 12 },
  chan: { w: 240, pad: 8, headerH: 40, rowH: 36, rowGap: 2, icon: 16, labelH: 22 },
  chat: {
    pad: 14,
    headerH: 40,
    avatar: 51,
    avatarGap: 12,
    nameH: 14,
    lineH: 20,
    groupGap: 14,
    composerH: 48,
  },
  mem: { w: 240, pad: 8, headerH: 40, avatar: 32, gap: 8, rowH: 44, rowGap: 2, labelH: 22 },
  /** Cap height of a line of text, as a fraction of its font size. */
  ink: 0.72,
} as const;

/** A quiet server, not a full one. The empty space in the panels is the point. */
const COUNT = { rail: 3, text: 4, voice: 2, messages: 3, members: 5 } as const;

const CHANNEL_WIDTHS = ["66%", "48%", "74%", "41%", "58%", "69%"];
const MEMBER_WIDTHS = ["56%", "42%", "64%", "37%", "50%"];
const MEMBER_HUES = ["accent", "secondary", "success", "warning", "secondaryLight"] as const;
const MESSAGES = [
  { hue: "secondary", lines: [0.93, 0.58] },
  { hue: "warning", lines: [0.7] },
  { hue: "accent", lines: [0.86, 0.47], mention: true },
] as const;

export interface ThemePreviewProps {
  theme: GrytTheme;
  appearance: GrytAppearance;
  /** Width in CSS pixels. Height follows from the window's aspect. */
  width: number;
}

export function ThemePreview({ theme, appearance, width }: ThemePreviewProps) {
  const n = theme[appearance];
  const hue = appearance === "light" && theme.lightHue ? theme.lightHue : theme.hue;
  const k = width / REAL.w;

  const px = (v: number) => `${(v * k).toFixed(2)}px`;
  const rad = (key: keyof GrytTheme["radius"]) => `${(theme.radius[key] * k).toFixed(2)}px`;
  // Never thinner than a pixel, or the text vanishes instead of shrinking.
  const line = (size: number) => `${Math.max(1, size * REAL.ink * k).toFixed(2)}px`;

  const bar = (color: string, opacity: number, w: string, size: number) => (
    <span
      style={{
        display: "block",
        background: color,
        opacity,
        width: w,
        height: line(size),
        borderRadius: px(2),
      }}
    />
  );

  const disc = (color: string, d: number, radius: string, style?: React.CSSProperties) => (
    <span
      style={{
        display: "block",
        flex: "none",
        background: color,
        width: px(d),
        height: px(d),
        borderRadius: radius,
        ...style,
      }}
    />
  );

  const panelStyle: React.CSSProperties = {
    background: n.surface,
    border: `1px solid ${n.border}`,
    borderRadius: rad("lg"),
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };

  const header = (w: string) => (
    <div
      style={{
        height: px(REAL.chan.headerH),
        flex: "none",
        display: "flex",
        alignItems: "center",
        padding: `0 ${px(10)}`,
        borderBottom: `1px solid ${n.border}`,
      }}
    >
      {bar(n.text, 0.85, w, 15)}
    </div>
  );

  const divider = (key: string) => (
    <div
      key={key}
      style={{
        height: px(REAL.chan.labelH),
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: px(6),
        padding: `0 ${px(6)}`,
      }}
    >
      <span style={{ display: "block", height: 1, flex: 1, background: n.border }} />
      {bar(n.muted, 0.55, "24%", 12)}
      <span style={{ display: "block", height: 1, flex: 1, background: n.border }} />
    </div>
  );

  const channelRow = (i: number, active: boolean) => (
    <div
      key={`ch${i}`}
      style={{
        height: px(REAL.chan.rowH),
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: px(8),
        padding: `0 ${px(12)}`,
        borderRadius: rad("full"),
        ...(active ? { background: n.surfaceHover } : null),
      }}
    >
      {disc(active ? hue.accent : n.muted, REAL.chan.icon, rad("sm"), active ? undefined : { opacity: 0.45 })}
      {bar(
        active ? hue.accent : n.muted,
        active ? 0.95 : 0.5,
        CHANNEL_WIDTHS[i % CHANNEL_WIDTHS.length],
        14,
      )}
    </div>
  );

  const chatWidth =
    REAL.w - REAL.pad * 2 - REAL.gap * 3 - REAL.rail.w - REAL.chan.w - REAL.mem.w;
  const bodyWidth = chatWidth - REAL.chat.pad * 2 - REAL.chat.avatar - REAL.chat.avatarGap;

  const memberRow = (i: number, offline: boolean, speaking: boolean) => (
    <div
      key={`m${i}`}
      style={{
        height: px(REAL.mem.rowH),
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: px(REAL.mem.gap),
        padding: `0 ${px(10)}`,
        borderRadius: rad("xl"),
      }}
    >
      {disc(
        offline ? n.muted : hue[MEMBER_HUES[i % MEMBER_HUES.length]],
        REAL.mem.avatar,
        "50%",
        speaking
          ? { boxShadow: `0 0 0 ${px(2.5)} ${hue.success}` }
          : offline
            ? { opacity: 0.4 }
            : undefined,
      )}
      {bar(n.text, offline ? 0.32 : 0.6, MEMBER_WIDTHS[i % MEMBER_WIDTHS.length], 14)}
    </div>
  );

  const online = COUNT.members - 2;

  return (
    <div
      aria-hidden="true"
      style={{
        background: n.bg,
        padding: px(REAL.pad),
        display: "flex",
        gap: px(REAL.gap),
        width,
        height: Math.round(REAL.h * k),
        overflow: "hidden",
      }}
    >
      <div
        style={{
          ...panelStyle,
          width: px(REAL.rail.w),
          flex: "none",
          alignItems: "center",
          gap: px(REAL.rail.gap),
          padding: `${px(REAL.rail.padY)} 0`,
        }}
      >
        {Array.from({ length: COUNT.rail }, (_, i) => (
          <span
            key={i}
            style={{
              display: "block",
              flex: "none",
              background: i === 0 ? hue.accent : i === 1 ? hue.secondary : n.muted,
              opacity: i > 1 ? 0.45 : 1,
              width: px(REAL.rail.icon),
              height: px(REAL.rail.icon),
              borderRadius: rad("md"),
            }}
          />
        ))}
        <span
          style={{
            display: "block",
            flex: "none",
            border: `1px dashed ${n.border}`,
            width: px(REAL.rail.icon),
            height: px(REAL.rail.icon),
            borderRadius: rad("md"),
          }}
        />
      </div>

      <div style={{ ...panelStyle, width: px(REAL.chan.w), flex: "none" }}>
        {header("56%")}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: px(REAL.chan.rowGap),
            padding: px(REAL.chan.pad),
            overflow: "hidden",
          }}
        >
          {divider("text")}
          {Array.from({ length: COUNT.text }, (_, i) => channelRow(i, i === 2))}
          {divider("voice")}
          {Array.from({ length: COUNT.voice }, (_, i) => channelRow(i + COUNT.text, false))}
        </div>
      </div>

      <div style={{ ...panelStyle, flex: 1, minWidth: 0 }}>
        {header("28%")}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            gap: px(REAL.chat.groupGap),
            padding: px(REAL.chat.pad),
            overflow: "hidden",
          }}
        >
          {MESSAGES.slice(0, COUNT.messages).map((group, gi) => (
            <div
              key={gi}
              style={{ display: "flex", gap: px(REAL.chat.avatarGap), alignItems: "flex-start", flex: "none" }}
            >
              {disc(hue[group.hue], REAL.chat.avatar, "50%")}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: px(3) }}>
                {bar(n.text, 0.78, "24%", REAL.chat.nameH)}
                {group.lines.map((w, i) => (
                  <div
                    key={i}
                    style={{
                      height: px(REAL.chat.lineH - 4),
                      display: "flex",
                      alignItems: "center",
                      gap: px(5),
                    }}
                  >
                    {"mention" in group && group.mention && i === 0 ? (
                      <>
                        <span
                          style={{
                            display: "block",
                            background: hue.accent,
                            opacity: 0.3,
                            width: px(bodyWidth * 0.22),
                            height: px(REAL.chat.lineH - 7),
                            borderRadius: rad("sm"),
                          }}
                        />
                        {bar(n.muted, 0.6, `${((w - 0.24) * 100).toFixed(0)}%`, 14)}
                      </>
                    ) : (
                      bar(n.muted, 0.6, `${(w * 100).toFixed(0)}%`, 14)
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            flex: "none",
            margin: `0 ${px(REAL.chat.pad)} ${px(REAL.chat.pad)}`,
            height: px(REAL.chat.composerH),
            display: "flex",
            alignItems: "center",
            gap: px(8),
            padding: `0 ${px(14)}`,
            background: n.surfaceRaised,
            border: `1px solid ${n.border}`,
            borderRadius: rad("lg"),
          }}
        >
          {bar(n.muted, 0.45, "44%", 14)}
          <span style={{ flex: 1 }} />
          {disc(hue.accent, 22, "50%")}
        </div>
      </div>

      <div style={{ ...panelStyle, width: px(REAL.mem.w), flex: "none" }}>
        {header("40%")}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: px(REAL.mem.rowGap),
            padding: px(REAL.mem.pad),
            overflow: "hidden",
          }}
        >
          {divider("online")}
          {Array.from({ length: online }, (_, i) => memberRow(i, false, i === 0))}
          {divider("offline")}
          {Array.from({ length: COUNT.members - online }, (_, i) =>
            memberRow(online + i, true, false),
          )}
        </div>
      </div>
    </div>
  );
}
