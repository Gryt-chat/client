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

export interface Person {
  discordUserId: string;
  name: string | null;
  avatar: string | null;
  messages: number;
  linkedTo: string | null;
  proof: "code" | "admin" | null;
  sync: boolean;
}

export interface Preview {
  hasMessages: boolean;
  name: string | null;
  emoji: number;
  emojiClashes: string[];
  roles: number;
}

export interface Member {
  serverUserId: string;
  nickname: string;
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

/** Everyone on the Discord server and everyone whose messages came from it, with who they're linked to. */
export function usePeople(host: string) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const load = useCallback(async () => {
    const res = await bridgeFetch(host, "/bridge/people");
    if (res.ok) setPeople(((await res.json()) as { people: Person[] }).people);
  }, [host]);
  useEffect(() => void load(), [load]);

  const link = async (discordUserId: string, serverUserId: string | null) => {
    const res = serverUserId
      ? await bridgeFetch(host, `/bridge/people/${discordUserId}`, { method: "PUT", body: JSON.stringify({ serverUserId }) })
      : await bridgeFetch(host, `/bridge/people/${discordUserId}`, { method: "DELETE" });
    if (!res.ok) toast.error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "That didn't work. Try again in a moment.");
    await load();
  };
  const setSync = async (discordUserId: string, sync: boolean, removeCopied = false) => {
    const res = await bridgeFetch(host, "/bridge/sync", { method: "PUT", body: JSON.stringify({ kind: "discord", id: discordUserId, sync, removeCopied }) });
    if (!res.ok) toast.error("That didn't work. Try again in a moment.");
    await load();
  };
  return { people, link, setSync };
}

export function usePreview(host: string): Preview | null {
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    void (async () => {
      const res = await bridgeFetch(host, "/bridge/preview");
      if (res.ok) setPreview((await res.json()) as Preview);
    })();
  }, [host]);
  return preview;
}
