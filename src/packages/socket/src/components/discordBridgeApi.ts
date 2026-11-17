import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken, getServerHttpBase } from "@/common";

export type Target = "new" | "skip" | string;

export interface DiscordChannel {
  id: string;
  name: string;
  kind: "text" | "voice";
  category: string | null;
  target: Target;
  suggested: string | null;
}

export function bridgeFetch(host: string, path: string, init?: RequestInit): Promise<Response> {
  const auth = getServerAccessToken(host);
  return fetch(`${getServerHttpBase(host)}/api/discord${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
  });
}

/** Where each Discord channel goes. Suggested matches start picked; the owner can change any of them. */
export function useChannelMatches(host: string) {
  const [channels, setChannels] = useState<DiscordChannel[] | null>(null);
  const [gryt, setGryt] = useState<{ id: string; name: string; kind: "text" | "voice" }[]>([]);
  const [picks, setPicks] = useState<Record<string, Target>>({});

  useEffect(() => {
    void (async () => {
      const res = await bridgeFetch(host, "/bridge/channels");
      if (!res.ok) return;
      const body = (await res.json()) as { discord: DiscordChannel[]; gryt: { id: string; name: string; kind: "text" | "voice" }[] };
      setChannels(body.discord);
      setGryt(body.gryt);
      setPicks(Object.fromEntries(body.discord.map((d) => [d.id, d.target === "new" && d.suggested ? d.suggested : d.target])));
    })();
  }, [host]);

  const save = useCallback(async () => {
    if (!channels) return true;
    const res = await bridgeFetch(host, "/bridge/channels", {
      method: "PUT",
      body: JSON.stringify({ matches: channels.map((d) => ({ discordChannelId: d.id, target: picks[d.id] ?? "new" })) }),
    });
    if (!res.ok) toast.error("Each Discord channel goes to one channel here. Check for two going to the same one.");
    return res.ok;
  }, [channels, host, picks]);

  return { channels, gryt, picks, setPicks, save };
}

