/** Top left in fullscreen: which call this is, and how to leave. */
export function FullscreenLabel({ channelName, serverName, people, hidden }: {
  channelName: string;
  serverName: string;
  people: number;
  hidden: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute z-10 flex items-center gap-2.5 rounded-full px-3.5 py-1.5 text-[13px] transition-opacity duration-300"
      style={{ left: 20, top: 20, background: "rgba(17,19,24,.85)", opacity: hidden ? 0 : 1 }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: "var(--gryt-success-9)" }} />
      <span className="font-bold">{channelName}</span>
      <span className="text-gryt-muted">{serverName} · {people} {people === 1 ? "person" : "people"}</span>
      <span className="text-gryt-muted">Esc to exit</span>
    </div>
  );
}
