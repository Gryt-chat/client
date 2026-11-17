import { Avatar, Button, Combobox, Select, Surface, Switch } from "@gryt/ui";
import { useState } from "react";
import toast from "react-hot-toast";

import { DiscordLogo } from "../../../../lib/icons";
import { bridgeFetch, type Member, type useChannelMatches, type usePeople } from "./discordBridgeApi";

const sign = (kind: "text" | "voice") => (kind === "voice" ? "🔊" : "#");

/** Every Discord channel and where it goes here, grouped like Discord's sidebar. */
export function ChannelMatches({ matches }: { matches: ReturnType<typeof useChannelMatches> }) {
  const { channels, gryt, picks, setPicks } = matches;
  if (!channels) return null;
  const taken = new Map(Object.entries(picks).filter(([, t]) => t !== "new" && t !== "skip").map(([d, t]) => [t, d]));
  const onlyHere = gryt.filter((g) => !taken.has(g.id));

  const row = (d: (typeof channels)[number]) => {
    const options = [
      { label: `+ New ${d.kind === "voice" ? "voice channel" : "channel"} “${d.name}”`, value: "new" },
      { label: "– Skip, don't link it", value: "skip" },
      ...gryt
        .filter((g) => g.kind === d.kind && (!taken.has(g.id) || taken.get(g.id) === d.id))
        .map((g) => ({ label: `${sign(g.kind)} ${g.name}${d.suggested === g.id ? " · suggested" : ""}`, value: g.id })),
    ];
    return (
      <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 text-sm">
        <span className="min-w-0 flex-1 truncate">
          <span className="text-gryt-muted">{sign(d.kind)}</span> {d.name}
          {d.category && <span className="text-gryt-muted"> · {d.category}</span>}
        </span>
        <span className="text-gryt-muted" aria-hidden>→</span>
        <div className="w-60 max-w-full shrink-0">
          <Select value={picks[d.id] ?? "new"} onValueChange={(v) => setPicks((p) => ({ ...p, [d.id]: String(v) }))} options={options} />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {(["text", "voice"] as const).map((kind) => {
        const list = channels.filter((d) => d.kind === kind);
        if (list.length === 0) return null;
        return (
          <div key={kind} className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gryt-muted">{kind === "text" ? "Text" : "Voice"}</span>
            <Surface className="flex flex-col p-1">{list.map(row)}</Surface>
          </div>
        );
      })}
      {onlyHere.length > 0 && (
        <span className="text-sm text-gryt-muted">
          Only here, not on Discord: {onlyHere.map((g) => `${sign(g.kind)} ${g.name}`).join(", ")}. They stay on this server.
        </span>
      )}
      <span className="text-sm text-gryt-muted">Voice channels get linked too, so names and order stay in step. The voice itself isn&rsquo;t bridged.</span>
    </div>
  );
}

/** Pick which member a Discord person is. A member someone else already has isn't offered again. */
function MemberPicker({ members, takenBy, value, onPick }: { members: Member[]; takenBy: Set<string>; value: string | null; onPick: (id: string | null) => void }) {
  const items = members.filter((m) => m.serverUserId === value || !takenBy.has(m.serverUserId));
  const current = members.find((m) => m.serverUserId === value) ?? null;
  return (
    <Combobox.Root
      items={items}
      value={current}
      onValueChange={(m: Member | null) => onPick(m?.serverUserId ?? null)}
      itemToStringLabel={(m: Member) => m.nickname}
      isItemEqualToValue={(a: Member, b: Member) => a.serverUserId === b.serverUserId}
    >
      <Combobox.Input placeholder="Not linked · pick a member" aria-label="Member here" />
      <Combobox.Portal>
        <Combobox.Positioner>
          <Combobox.Popup>
            <Combobox.Empty>No member by that name, or they&rsquo;re linked already</Combobox.Empty>
            <Combobox.List>
              {(m: Member) => (
                <Combobox.Item key={m.serverUserId} value={m}>
                  {m.nickname}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** People on the Discord server, each linkable to one member here, and each with their own sync switch. */
export function DiscordPeople({ people: hook, members }: { people: ReturnType<typeof usePeople>; members: Member[] }) {
  const { people, link, setSync } = hook;
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  if (!people) return null;
  if (people.length === 0) return <span className="text-sm text-gryt-muted">Nobody from Discord yet.</span>;
  const takenBy = new Set(people.flatMap((p) => (p.linkedTo ? [p.linkedTo] : [])));

  return (
    <Surface className="flex flex-col p-1">
      {people.map((p) => (
        <div key={p.discordUserId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 text-sm">
          <Switch
            checked={p.sync}
            aria-label={`Sync ${p.name ?? "this person"}`}
            onCheckedChange={(on) => (on ? void setSync(p.discordUserId, true) : setConfirmOff(p.discordUserId))}
          />
          <Avatar size="small" src={p.avatar ?? undefined} seed={p.discordUserId} alt="" />
          <span className={`flex min-w-0 flex-1 flex-col ${p.sync ? "" : "text-gryt-muted line-through"}`}>
            <span className="flex items-center gap-1.5 truncate">
              {p.name ?? "Discord user"} <DiscordLogo size={12} color="#5865F2" aria-label="Discord" />
            </span>
            <span className="text-xs text-gryt-muted">
              {p.messages > 0 ? `${p.messages.toLocaleString()} messages` : "No messages copied yet"}
              {p.proof === "code" ? " · proved with /link" : ""}
            </span>
          </span>
          <div className="w-56 max-w-full shrink-0">
            <MemberPicker members={members} takenBy={takenBy} value={p.linkedTo} onPick={(id) => void link(p.discordUserId, id)} />
          </div>
          {confirmOff === p.discordUserId && (
            <span className="flex w-full flex-wrap items-center gap-2 pl-12">
              <span className="text-gryt-muted">Stop syncing {p.name ?? "them"}?</span>
              <Button size="small" tone="ghost" onClick={() => void setSync(p.discordUserId, false).then(() => setConfirmOff(null))}>Stop, keep what&rsquo;s here</Button>
              <Button size="small" tone="danger" onClick={() => void setSync(p.discordUserId, false, true).then(() => setConfirmOff(null))}>Stop and remove their messages</Button>
              <Button size="small" tone="ghost" onClick={() => setConfirmOff(null)}>Cancel</Button>
            </span>
          )}
        </div>
      ))}
    </Surface>
  );
}

/** Members whose messages go to Discord. Everyone is on until the owner switches them off. */
export function MembersToDiscord({ host, members, excluded, onChange }: { host: string; members: Member[]; excluded: string[]; onChange: () => void }) {
  if (members.length === 0) return null;
  const off = new Set(excluded);
  const setSync = async (id: string, sync: boolean) => {
    const res = await bridgeFetch(host, "/bridge/sync", { method: "PUT", body: JSON.stringify({ kind: "gryt", id, sync }) });
    if (!res.ok) toast.error("That didn't work. Try again in a moment.");
    onChange();
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Members posted to Discord</span>
      <span className="text-sm text-gryt-muted">Switch someone off and what they write here stays here.</span>
      <Surface className="flex flex-col gap-1 p-2">
        {members.map((m) => (
          <label key={m.serverUserId} className="flex items-center gap-3 px-2 py-1 text-sm">
            <Switch checked={!off.has(m.serverUserId)} onCheckedChange={(on) => void setSync(m.serverUserId, on)} />
            <span className={off.has(m.serverUserId) ? "text-gryt-muted line-through" : ""}>{m.nickname}</span>
          </label>
        ))}
      </Surface>
    </div>
  );
}

const KINDS: { kind: string; label: string }[] = [
  { kind: "messages", label: "Messages" },
  { kind: "edits", label: "Edits" },
  { kind: "deletes", label: "Deletes" },
  { kind: "replies", label: "Replies" },
  { kind: "reactions", label: "Reactions" },
  { kind: "emoji", label: "Custom emoji" },
  { kind: "pins", label: "Pins" },
  { kind: "threads", label: "Threads" },
  { kind: "files", label: "Files" },
];

/** What crosses between the two. Switching one off only affects what happens from now on. */
export function SyncKinds({ off, onChange }: { off: string[]; onChange: (off: string[]) => void }) {
  const set = new Set(off);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {KINDS.map(({ kind, label }) => (
        <label key={kind} className="flex items-center gap-2 text-sm">
          <Switch
            checked={!set.has(kind)}
            onCheckedChange={(on) => onChange(on ? off.filter((k) => k !== kind) : [...off, kind])}
          />
          {label}
        </label>
      ))}
    </div>
  );
}
