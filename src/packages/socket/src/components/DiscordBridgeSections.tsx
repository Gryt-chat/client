import { Button, Select, Surface, Switch } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { bridgeFetch, type useChannelMatches } from "./discordBridgeApi";

interface Person {
  discordUserId: string;
  name: string | null;
  messages: number;
  linkedTo: string | null;
  proof: "code" | "admin" | null;
  sync: boolean;
}

export function ChannelMatches({ matches }: { matches: ReturnType<typeof useChannelMatches> }) {
  const [open, setOpen] = useState(false);
  const { channels, gryt, picks, setPicks } = matches;
  if (!channels || channels.length === 0) return null;
  const matched = channels.filter((d) => picks[d.id] !== "new" && picks[d.id] !== "skip").length;
  const skipped = channels.filter((d) => picks[d.id] === "skip").length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm">
          <span className="font-medium">Channels:</span>{" "}
          <span className="text-gryt-muted">
            {channels.length - matched - skipped} new, {matched} into channels already here, {skipped} left out
          </span>
        </span>
        <Button size="small" tone="ghost" onClick={() => setOpen((o) => !o)}>{open ? "Done" : "Change"}</Button>
      </div>
      {open && (
        <Surface className="flex flex-col gap-1 p-2">
          {channels.map((d) => {
            const options = [
              { label: `New channel “${d.name}”`, value: "new" },
              { label: "Skip, don't copy it", value: "skip" },
              ...gryt.filter((g) => g.kind === d.kind).map((g) => ({ label: `${g.kind === "voice" ? "🔊" : "#"} ${g.name}${d.suggested === g.id ? " (suggested)" : ""}`, value: g.id })),
            ];
            return (
              <div key={d.id} className="flex items-center gap-3 px-2 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-gryt-muted">{d.kind === "voice" ? "🔊" : "#"}</span> {d.name}
                  {d.category && <span className="text-gryt-muted"> · {d.category}</span>}
                </span>
                <div className="w-64 shrink-0">
                  <Select value={picks[d.id] ?? "new"} onValueChange={(v) => setPicks((p) => ({ ...p, [d.id]: String(v) }))} options={options} />
                </div>
              </div>
            );
          })}
        </Surface>
      )}
    </div>
  );
}

/** Everyone whose messages came from Discord. Linking shows their messages as the member's; unlinking undoes it. */
export function DiscordPeople({ host, members }: { host: string; members: { serverUserId: string; nickname: string }[] }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const load = useCallback(async () => {
    const res = await bridgeFetch(host, "/bridge/people");
    if (res.ok) setPeople(((await res.json()) as { people: Person[] }).people);
  }, [host]);
  useEffect(() => void load(), [load]);

  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const setSync = async (discordUserId: string, sync: boolean, removeCopied = false) => {
    const res = await bridgeFetch(host, "/bridge/sync", { method: "PUT", body: JSON.stringify({ kind: "discord", id: discordUserId, sync, removeCopied }) });
    if (!res.ok) toast.error("That didn't work. Try again in a moment.");
    setConfirmOff(null);
    await load();
  };

  const link = async (discordUserId: string, serverUserId: string | null) => {
    const res = serverUserId
      ? await bridgeFetch(host, `/bridge/people/${discordUserId}`, { method: "PUT", body: JSON.stringify({ serverUserId }) })
      : await bridgeFetch(host, `/bridge/people/${discordUserId}`, { method: "DELETE" });
    if (!res.ok) toast.error("That didn't work. Try again in a moment.");
    await load();
  };

  if (!people || people.length === 0) return null;
  const name = (id: string) => members.find((m) => m.serverUserId === id)?.nickname ?? "a member";

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">People from Discord</span>
      <span className="text-sm text-gryt-muted">
        Link someone to a member here and their messages show under that member. They can do it themselves with /link on the bot. Unlinking puts the Discord name back. Switch someone off and nothing of theirs is copied any more.
      </span>
      <Surface className="flex flex-col gap-1 p-2">
        {people.map((p) => (
          <div key={p.discordUserId} className="flex flex-wrap items-center gap-3 px-2 py-1 text-sm">
            <Switch
              checked={p.sync}
              aria-label={`Sync ${p.name ?? "this person"}`}
              onCheckedChange={(on) => (on ? void setSync(p.discordUserId, true) : setConfirmOff(p.discordUserId))}
            />
            <span className={`min-w-0 flex-1 truncate ${p.sync ? "" : "text-gryt-muted line-through"}`}>
              {p.name ?? "Discord user"} <span className="text-gryt-muted">· {p.messages.toLocaleString()} messages</span>
            </span>
            {confirmOff === p.discordUserId && (
              <span className="flex w-full flex-wrap items-center gap-2 pl-12">
                <span className="text-gryt-muted">Stop syncing {p.name ?? "them"}?</span>
                <Button size="small" tone="ghost" onClick={() => void setSync(p.discordUserId, false)}>Stop, keep what&rsquo;s here</Button>
                <Button size="small" tone="danger" onClick={() => void setSync(p.discordUserId, false, true)}>Stop and remove their messages</Button>
                <Button size="small" tone="ghost" onClick={() => setConfirmOff(null)}>Cancel</Button>
              </span>
            )}
            {p.linkedTo ? (
              <>
                <span className="text-gryt-muted">→ {name(p.linkedTo)}{p.proof === "code" ? " (proved)" : ""}</span>
                <Button size="small" tone="ghost" onClick={() => void link(p.discordUserId, null)}>Unlink</Button>
              </>
            ) : (
              <div className="w-52 shrink-0">
                <Select
                  value=""
                  placeholder="Link to a member"
                  onValueChange={(v) => void link(p.discordUserId, String(v))}
                  options={members.map((m) => ({ label: m.nickname, value: m.serverUserId }))}
                />
              </div>
            )}
          </div>
        ))}
      </Surface>
    </div>
  );
}

/** Members whose messages go to Discord. Everyone is on until the owner switches them off. */
export function MembersToDiscord({ host, members, excluded, onChange }: {
  host: string;
  members: { serverUserId: string; nickname: string }[];
  excluded: string[];
  onChange: () => void;
}) {
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
