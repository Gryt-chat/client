import { useEffect, useState } from "react";

import { getPreviewImageUrl, getServerAccessToken, getServerHttpBase } from "@/common";
import { useSettings } from "@/settings/src/hooks/useSettings";

import { type LinkPreviewData, previewCache, previewRefused } from "../components/embedUtils";
import { nextPreviewStep, type PreviewFailure } from "../components/linkPreviewRetry";
import { useTrustedEmbedHosts } from "../lib/trustedEmbedHosts";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** The server's preview of a link, cached across cards, and where its pictures may load from. */
export function useLinkPreview(url: string, serverHost: string) {
  // The picture and favicon come from the linked site itself; the text came through the server.
  const { autoLoadEmbeds } = useSettings();
  const trusted = useTrustedEmbedHosts();
  const remoteImagesOk = autoLoadEmbeds || trusted.includes(hostOf(url));
  const [data, setData] = useState<LinkPreviewData | null>(() => previewCache.get(url) ?? null);
  const [failed, setFailed] = useState(() => previewRefused.has(url));

  useEffect(() => {
    if (data) return;
    // Asked before and refused. Nothing about the answer can have changed.
    if (previewRefused.has(url)) { setFailed(true); return; }

    const accessToken = getServerAccessToken(serverHost);
    if (!accessToken) {
      setFailed(true);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const base = getServerHttpBase(serverHost);

    const settle = (attempt: number, failure: PreviewFailure) => {
      const step = nextPreviewStep(failure, attempt);
      if (step.action === "retry") {
        timer = setTimeout(() => void request(attempt + 1), step.delayMs);
        return;
      }
      if (step.action === "refuse") previewRefused.add(url);
      setFailed(true);
    };

    const request = async (attempt: number) => {
      let res: Response;
      try {
        res = await fetch(`${base}/api/link-preview?url=${encodeURIComponent(url)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        if (!cancelled) settle(attempt, { kind: "network" });
        return;
      }
      if (cancelled) return;

      if (!res.ok) {
        // Retry-After is not CORS-exposed, so cross-origin the body's retryAfterMs is what we get.
        const body = res.status === 429 ? await res.json().catch(() => null) : null;
        if (cancelled) return;
        settle(attempt, {
          kind: "status",
          status: res.status,
          retryAfter: res.headers.get("Retry-After"),
          retryAfterMs: (body as { retryAfterMs?: unknown } | null)?.retryAfterMs,
        });
        return;
      }

      try {
        const d = (await res.json()) as LinkPreviewData;
        if (cancelled) return;
        previewCache.set(url, d);
        setData(d);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    void request(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, serverHost, data]);

  // A server that fetches the picture and icon itself hands out ids for them, and then the setting needn't hold them back.
  const pictureSrc = (id: string | null | undefined, direct: string | null) => {
    if (id) return getPreviewImageUrl(serverHost, id);
    return remoteImagesOk ? direct : null;
  };
  return { data, failed, pictureSrc };
}
