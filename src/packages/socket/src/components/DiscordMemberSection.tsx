import { Avatar, MemberItem as MemberRow } from "@gryt/ui";
import { useEffect, useState } from "react";

import { DiscordLogo } from "../../../../lib/icons";
import { useSockets } from "../hooks/useSockets";
import { bridgeFetch } from "./discordBridgeApi";

type DiscordStatus = "online" | "idle" | "dnd" | "offline";

interface DiscordPerson {
  discordUserId: string;
  name: string;
  avatar: string;
  status: DiscordStatus;
}

const STATUS: Record<DiscordStatus, { label?: string; color: string; order: number }> = {
  online: { color: "var(--gryt-success-9)", order: 0 },
  idle: { label: "Idle", color: "var(--gryt-warning-9)", order: 1 },
  dnd: { label: "Do not disturb", color: "var(--gryt-danger-9)", order: 2 },
  offline: { color: "var(--gryt-neutral-9)", order: 3 },
};

/** People still on Discord, under the members, with the status Discord gives them. The server nudges when it changes. */
export function DiscordMemberSection({ host, avatarsOnly, className }: { host: string; avatarsOnly: boolean; className: string }) {
  const { sockets, serverDetailsList } = useSockets();
  const enabled = !!serverDetailsList[host]?.server_info?.discord_bridge;
  const socket = sockets[host];
  const [people, setPeople] = useState<DiscordPerson[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = async () => {
      const res = await bridgeFetch(host, "/people").catch(() => null);
      if (!res?.ok || !live) return;
      setPeople(((await res.json()) as { people: DiscordPerson[] }).people);
    };
    void load();
    socket?.on("discord:people", load);
    return () => {
      live = false;
      socket?.off("discord:people", load);
    };
  }, [enabled, host, socket]);

  if (!enabled || people.length === 0) return null;
  const sorted = [...people].sort((a, b) => STATUS[a.status].order - STATUS[b.status].order || a.name.localeCompare(b.name));

  return (
    <section aria-labelledby="members-discord" className={className}>
      <h3
        id="members-discord"
        className={avatarsOnly ? "sr-only" : "flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gryt-muted"}
        style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--gryt-neutral-3)", padding: "2px 4px 6px", margin: 0 }}
      >
        <DiscordLogo size={12} aria-hidden /> On Discord — {people.length}
      </h3>
      <div className="flex flex-col gap-1">
        {sorted.map((p) => {
          const s = STATUS[p.status];
          return (
            <MemberRow
              key={p.discordUserId}
              compact={avatarsOnly}
              name={p.name}
              offline={p.status === "offline"}
              avatar={<Avatar size="small" className={avatarsOnly ? "h-6 w-6 text-[10px]" : undefined} src={p.avatar} fallback={p.name[0]} alt="" />}
              status={s.label}
              statusColor={s.color}
            />
          );
        })}
      </div>
    </section>
  );
}
