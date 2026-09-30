import { Button } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { getServerHttpBase } from "@/common";

const size = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The server's cached game art, and a way to empty it (GRYT-1602). Only for people who manage the server. */
export function GameArtCacheSetting({ host, accessToken }: { host: string; accessToken: string | null }) {
  const [cache, setCache] = useState<{ games: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const auth = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;

  useEffect(() => {
    if (!accessToken) return;
    let live = true;
    // A server older than the cache simply answers 404, and the section stays hidden.
    void fetch(`${getServerHttpBase(host)}/api/game-art/cache`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => live && body && setCache(body as { games: number; bytes: number }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [host, accessToken]);

  if (!cache) return null;

  const clear = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${getServerHttpBase(host)}/api/game-art/cache`, { method: "DELETE", headers: auth });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setCache({ games: 0, bytes: 0 });
      toast.success("Game art cleared");
    } catch (err) {
      toast.error(`Couldn't clear the game art: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Game art</span>
      <span className="text-xs" style={{ lineHeight: 1.4 }}>
        The pictures behind games on member cards, fetched from Steam once and kept here. Each one is
        checked for a newer version once a day. Clearing them fetches each again the next time someone plays.
      </span>
      <div className="flex items-center gap-2">
        <Button size="small" tone="neutral" disabled={busy || cache.games === 0} onClick={() => void clear()}>
          Clear game art
        </Button>
        <span className="text-xs text-gryt-muted">
          {cache.games === 0 ? "Nothing cached" : `${cache.games} game${cache.games === 1 ? "" : "s"}, ${size(cache.bytes)}`}
        </span>
      </div>
    </div>
  );
}
