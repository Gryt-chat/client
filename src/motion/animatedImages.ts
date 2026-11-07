// In a render, animated images would play on the wall clock. Decode their frames once and show
// the frame for the page's virtual time instead, before every screenshot.
type Frames = { urls: string[]; ends: number[]; total: number };
const cache = new Map<string, Promise<Frames>>();
const original = new WeakMap<HTMLImageElement, string>();

async function decode(url: string): Promise<Frames> {
  const res = await fetch(url);
  const type = res.headers.get("content-type") ?? "image/webp";
  const dec = new ImageDecoder({ data: await res.arrayBuffer(), type });
  await dec.tracks.ready;
  const count = dec.tracks.selectedTrack?.frameCount ?? 1;
  const canvas = document.createElement("canvas");
  const urls: string[] = [];
  const ends: number[] = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    canvas.width = image.displayWidth;
    canvas.height = image.displayHeight;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    urls.push(canvas.toDataURL("image/png"));
    t += (image.duration ?? 100_000) / 1000;
    ends.push(t);
    image.close();
  }
  return { urls, ends, total: t };
}

if (new URLSearchParams(location.search).has("render")) {
  (window as unknown as { __beforeShot: () => Promise<void> }).__beforeShot = async () => {
    const now = performance.now();
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("#stage img"));
    await Promise.all(imgs.map(async (img) => {
      const known = original.get(img);
      const src = known && img.src.startsWith("data:") ? known : img.src;
      if (!src.includes("/motion-assets/") && !src.includes("/api/uploads/files/")) return;
      original.set(img, src);
      if (!cache.has(src)) cache.set(src, decode(src).catch((e) => { console.error("motion: frames", e); return { urls: [], ends: [], total: 1 }; }));
      const f = await cache.get(src)!;
      if (f.urls.length < 2) return;
      const at = now % f.total;
      const next = f.urls[f.ends.findIndex((e) => at < e)] ?? f.urls[0];
      if (img.src !== next) {
        img.src = next;
        await img.decode().catch(() => {});
      }
    }));
  };
}
