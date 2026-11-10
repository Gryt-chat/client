// Virtual clock for motion.html?render. Timers, rAF, performance.now and every Web Animation
// follow window.__advance(ms) instead of the wall clock, so a render is the same every time.
type Timer = { at: number; fn: TimerHandler; args: unknown[]; every?: number };
const w = window as unknown as Record<string, unknown> & typeof window;

if (new URLSearchParams(location.search).has("render")) {
  (() => {
    const realTimeout = window.setTimeout.bind(window);
    const T0 = Date.now();
    let now = 0;
    let nextId = 1;
    const timers = new Map<number, Timer>();
    let frames = new Map<number, FrameRequestCallback>();
    const seen = new WeakMap<Animation, number>();

    performance.now = () => now;
    Date.now = () => T0 + Math.round(now);
    w.setTimeout = ((fn: TimerHandler, ms = 0, ...args: unknown[]) => {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args });
      return id;
    }) as typeof window.setTimeout;
    w.setInterval = ((fn: TimerHandler, ms = 0, ...args: unknown[]) => {
      const id = nextId++;
      const every = Math.max(1, Number(ms) || 0);
      timers.set(id, { at: now + every, fn, args, every });
      return id;
    }) as typeof window.setInterval;
    const clear = (id?: number) => { if (id !== undefined) timers.delete(id); };
    w.clearTimeout = clear as typeof window.clearTimeout;
    w.clearInterval = clear as typeof window.clearInterval;
    w.requestAnimationFrame = (fn: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, fn);
      return id;
    };
    w.cancelAnimationFrame = (id: number) => { frames.delete(id); };

    const settle = () => new Promise<void>((r) => realTimeout(r, 0));

    w.__advance = async (dt: number) => {
      const end = now + dt;
      for (;;) {
        let due: [number, Timer] | null = null;
        for (const [id, t] of timers) if (t.at <= end && (!due || t.at < due[1].at)) due = [id, t];
        if (!due) break;
        const [id, t] = due;
        now = Math.max(now, t.at);
        if (t.every) t.at += t.every;
        else timers.delete(id);
        try { if (typeof t.fn === "function") (t.fn as (...a: unknown[]) => void)(...t.args); } catch (e) { console.error(e); }
        await Promise.resolve();
      }
      now = end;
      const run = frames;
      frames = new Map();
      for (const fn of run.values()) {
        try { fn(now); } catch (e) { console.error(e); }
      }
      await settle();
      await settle();
      await (w.__beforeShot as (() => Promise<void>) | undefined)?.();
      for (const a of document.getAnimations()) {
        if (!seen.has(a)) seen.set(a, now - Number(a.currentTime ?? 0));
        const timing = a.effect?.getComputedTiming();
        const local = (now - (seen.get(a) ?? now)) * (a.playbackRate || 1);
        const end = Number(timing?.endTime);
        if (Number.isFinite(end) && local >= end) {
          try { a.finish(); } catch { a.pause(); }
        } else {
          a.pause();
          a.currentTime = local;
        }
      }
      await settle();
    };
  })();
}

export {};
