/**
 * How big each remote video is drawn, in device pixels, across every place it's drawn: the grid,
 * the focus view and popouts. The largest per stream goes to the engine, which tells the SFU.
 */

export interface DrawnSize {
  width: number;
  height: number;
  fps: number;
}

type Reporter = (streamId: string, size: DrawnSize | null) => void;

const views = new Map<string, Map<object, DrawnSize>>();
let reporter: Reporter | null = null;
let remote = new Set<string>();

function largest(streamId: string): DrawnSize {
  let best: DrawnSize = { width: 0, height: 0, fps: 0 };
  for (const size of views.get(streamId)?.values() ?? []) {
    best = {
      width: Math.max(best.width, size.width),
      height: Math.max(best.height, size.height),
      fps: Math.max(best.fps, size.fps),
    };
  }
  return best;
}

// A remote stream drawn nowhere reports 0x0, so a closed voice view stops its video too.
function flush(streamId: string) {
  if (reporter && remote.has(streamId)) reporter(streamId, largest(streamId));
}

/** Who to tell, and which stream ids are other people's. Our own self-view is never reported. */
export function setDrawnVideoReporter(next: Reporter | null, remoteStreamIds: Iterable<string>) {
  const ids = new Set(remoteStreamIds);
  const changed = next !== reporter;
  for (const id of remote) if (!ids.has(id) || changed) reporter?.(id, null);
  reporter = next;
  const added = [...ids].filter((id) => changed || !remote.has(id));
  remote = ids;
  for (const id of added) flush(id);
}

function setView(streamId: string, key: object, size: DrawnSize | null) {
  let byKey = views.get(streamId);
  if (size) {
    if (!byKey) views.set(streamId, (byKey = new Map()));
    byKey.set(key, size);
  } else if (byKey) {
    byKey.delete(key);
    if (byKey.size === 0) views.delete(streamId);
  }
  flush(streamId);
}

const refreshRates = new WeakMap<Window, number>();

/** The display's refresh rate from requestAnimationFrame, measured once per window. */
function measureRefreshRate(win: Window, done: () => void) {
  if (refreshRates.has(win) || win.document.visibilityState !== "visible") return;
  const stamps: number[] = [];
  const step = (t: number) => {
    stamps.push(t);
    if (stamps.length < 21) {
      win.requestAnimationFrame(step);
      return;
    }
    const gaps = stamps.slice(1).map((s, i) => s - stamps[i]).sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median > 0) refreshRates.set(win, Math.round(1000 / median));
    done();
  };
  win.requestAnimationFrame(step);
}

/** The box a video fills inside its element, which is bigger than the element one way for cover. */
export function drawnBox(
  box: { width: number; height: number },
  video: { width: number; height: number },
  fit: "cover" | "contain",
): { width: number; height: number } {
  if (!(box.width > 0 && box.height > 0)) return { width: 0, height: 0 };
  if (!(video.width > 0 && video.height > 0)) return box;
  const aspect = video.width / video.height;
  const wider = box.width / box.height > aspect;
  const byHeight = fit === "contain" ? wider : !wider;
  return byHeight
    ? { width: box.height * aspect, height: box.height }
    : { width: box.width, height: box.width / aspect };
}

/**
 * Watches one video element and keeps its drawn size registered under `streamId`: zero when it's
 * scrolled away, hidden, or its window is. Works for an element in a popout's document too.
 */
export function watchDrawnSize(el: HTMLVideoElement, streamId: string, fit: "cover" | "contain"): () => void {
  const win = el.ownerDocument.defaultView ?? window;
  const key = {};
  let intersecting = true;
  let stopped = false;

  // The refresh-rate probe calls back up to 21 frames later, which can be after the watch ended.
  const measure = () => {
    if (stopped) return;
    const visible = el.isConnected && intersecting && win.document.visibilityState === "visible";
    const box = drawnBox(
      { width: el.clientWidth, height: el.clientHeight },
      { width: el.videoWidth, height: el.videoHeight },
      fit,
    );
    const dpr = win.devicePixelRatio || 1;
    setView(streamId, key, {
      width: visible ? Math.round(box.width * dpr) : 0,
      height: visible ? Math.round(box.height * dpr) : 0,
      fps: refreshRates.get(win) ?? 60,
    });
  };

  const resize = new win.ResizeObserver(measure);
  resize.observe(el);
  const intersect = new win.IntersectionObserver((entries) => {
    intersecting = entries.some((entry) => entry.isIntersecting);
    measure();
  });
  intersect.observe(el);
  const onVisibility = () => {
    measureRefreshRate(win, measure);
    measure();
  };
  win.document.addEventListener("visibilitychange", onVisibility);
  el.addEventListener("resize", measure);
  // devicePixelRatio changes when the window moves to another screen or the zoom changes.
  const dprQuery = win.matchMedia(`(resolution: ${win.devicePixelRatio || 1}dppx)`);
  dprQuery.addEventListener("change", measure);
  measureRefreshRate(win, measure);
  measure();

  return () => {
    stopped = true;
    resize.disconnect();
    intersect.disconnect();
    win.document.removeEventListener("visibilitychange", onVisibility);
    el.removeEventListener("resize", measure);
    dprQuery.removeEventListener("change", measure);
    setView(streamId, key, null);
  };
}
