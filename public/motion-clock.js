// Virtual clock for motion.html?render. Timers, rAF, performance.now and every Web Animation
// follow window.__advance(ms) instead of the wall clock, so a render is the same every time.
if (new URLSearchParams(location.search).has("render")) {
  (() => {
    const realTimeout = window.setTimeout.bind(window);
    const T0 = Date.now();
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    let frames = new Map();
    const seen = new WeakMap();

    performance.now = () => now;
    Date.now = () => T0 + Math.round(now);
    window.setTimeout = (fn, ms = 0, ...args) => {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args });
      return id;
    };
    window.setInterval = (fn, ms = 0, ...args) => {
      const id = nextId++;
      const every = Math.max(1, Number(ms) || 0);
      timers.set(id, { at: now + every, fn, args, every });
      return id;
    };
    window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
    window.requestAnimationFrame = (fn) => {
      const id = nextId++;
      frames.set(id, fn);
      return id;
    };
    window.cancelAnimationFrame = (id) => frames.delete(id);

    const settle = () => new Promise((r) => realTimeout(r, 0));

    window.__advance = async (dt) => {
      const end = now + dt;
      for (;;) {
        let due = null;
        for (const [id, t] of timers) if (t.at <= end && (!due || t.at < due[1].at)) due = [id, t];
        if (!due) break;
        const [id, t] = due;
        now = Math.max(now, t.at);
        if (t.every) t.at += t.every;
        else timers.delete(id);
        try { if (typeof t.fn === "function") t.fn(...t.args); } catch (e) { console.error(e); }
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
      await window.__beforeShot?.();
      for (const a of document.getAnimations()) {
        if (!seen.has(a)) seen.set(a, now - (a.currentTime ?? 0));
        const timing = a.effect?.getComputedTiming();
        const local = (now - seen.get(a)) * (a.playbackRate || 1);
        if (timing && Number.isFinite(timing.endTime) && local >= timing.endTime) {
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
