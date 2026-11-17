import { Avatar, Button, Progress, Radio, RadioGroup, Spinner, Surface, Switch, TextField } from "@gryt/ui";
import { type ReactNode,useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken, getServerHttpBase } from "@/common";

import { DiscordLogo } from "../../../../lib/icons";
import { type Member,useChannelMatches, usePeople, usePreview } from "./discordBridgeApi";
import { ChannelMatches, DiscordPeople, MembersToDiscord, SyncKinds } from "./DiscordBridgeSections";

type Status = "connecting" | "token_invalid" | "intents_missing" | "waiting_for_invite" | "linked" | "removed";
type Direction = "to_gryt" | "both" | "to_discord";

interface CopyProgress {
  channels_total: number;
  channels_done: number;
  messages_imported: number;
  files_stored: number;
  current_channel?: string | null;
  channels?: { name: string; messages: number; done: boolean }[];
}

interface Guild {
  id: string;
  name: string | null;
  icon: string | null;
  members: number | null;
  channels: number | null;
}

type Bridge =
  | { configured: false }
  | {
      configured: true;
      applicationId: string;
      status: Status;
      guild: Guild | null;
      inviteUrl: string;
      direction: Direction | null;
      copy: { status: "idle" | "running" | "paused" | "done" | "failed"; progress: CopyProgress | null };
      syncNewChannels?: boolean;
      excludedMembers?: string[];
      syncOff?: string[];
      stats?: { messagesMatched: number; lastMessageAt: string | null } | null;
    };

const DIRECTIONS: { value: Direction; label: string; hint: string }[] = [
  { value: "to_gryt", label: "Discord → Gryt", hint: "Copy it all here and keep new messages coming. Discord stays the main place." },
  { value: "both", label: "Both ways", hint: "Same channels and messages on both sides. Whatever happens on one shows up on the other." },
  { value: "to_discord", label: "Gryt → Discord", hint: "Post what's said here into Discord, for people who haven't moved yet." },
];

const DIRECTION_LABEL: Record<Direction, string> = { to_gryt: "Discord → Gryt", both: "both ways", to_discord: "Gryt → Discord" };
const STEPS = ["Your Discord app", "Invite the bot", "Pick what to link", "Copy history", "Live"];

function ago(iso: string | null): string {
  if (!iso) return "no messages yet";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (s < 60) return `last message ${rtf.format(-s, "second")}`;
  if (s < 3600) return `last message ${rtf.format(-Math.round(s / 60), "minute")}`;
  if (s < 86400) return `last message ${rtf.format(-Math.round(s / 3600), "hour")}`;
  return `last message ${rtf.format(-Math.round(s / 86400), "day")}`;
}

function StepBar({ at }: { at: number }) {
  return (
    <ol className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 text-xs">
      {STEPS.map((label, i) => {
        let dot = "bg-gryt-neutral-5";
        if (i < at) dot = "bg-gryt-success-3 text-gryt-success";
        else if (i === at) dot = "bg-gryt-accent text-gryt-on-accent";
        return (
        <li key={label} className={`flex items-center gap-1.5 ${i === at ? "font-semibold text-gryt-text" : "text-gryt-muted"}`} aria-current={i === at ? "step" : undefined}>
          <span className={`grid size-5 place-items-center rounded-full ${dot}`}>
            {i < at ? "✓" : i + 1}
          </span>
          {label}
        </li>
        );
      })}
    </ol>
  );
}

function GuildCard({ guild, line, action }: { guild: Guild | null; line: ReactNode; action?: ReactNode }) {
  const name = guild?.name ?? "Discord server";
  return (
    <Surface className="flex items-center gap-3 p-3">
      <Avatar size="medium" src={guild?.icon ?? undefined} seed={guild?.id ?? name} alt="" fallback={name.slice(0, 2).toUpperCase()} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="text-xs text-gryt-muted">{line}</span>
      </span>
      {action}
    </Surface>
  );
}

function guildLine(g: Guild | null): string {
  const bits = ["The bot is in this Discord server"];
  if (g?.channels != null) bits.push(`${g.channels} channels`);
  if (g?.members != null) bits.push(`${g.members} members`);
  return bits.join(" · ");
}

/** Owner only, like the server's routes: the bridge writes as other people. */
export function ServerDiscordTab({ host, members = [] }: { host: string; members?: Member[] }) {
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [appId, setAppId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const call = useCallback(
    async (path: string, init?: RequestInit): Promise<Bridge | null> => {
      const auth = getServerAccessToken(host);
      const res = await fetch(`${getServerHttpBase(host)}/api/discord/bridge${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      });
      const body = (await res.json().catch(() => ({}))) as Bridge & { message?: string };
      if (!res.ok) {
        toast.error(body.message ?? "That didn't work. Try again in a moment.");
        return null;
      }
      setBridge(body);
      return body;
    },
    [host],
  );

  const waiting = bridge?.configured && (bridge.status !== "linked" || bridge.copy.status === "running");
  useEffect(() => {
    void call("");
    if (!waiting) return;
    const timer = setInterval(() => void call(""), 3000);
    return () => clearInterval(timer);
  }, [call, waiting]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied");
    } catch {
      toast.error("Couldn't copy it. Use Open invite link instead.");
    }
  };

  if (!bridge) {
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  }

  const tokenForm = (label: string) => (
    <div className="flex flex-col gap-3">
      {!bridge.configured && (
        <TextField label="Application ID" placeholder="1290384756102938475" value={appId} onChange={(e) => setAppId(e.target.value)} />
      )}
      <TextField
        label={label}
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        helperText="It stays on this server and never reaches anyone's app."
      />
      <div>
        <Button
          size="small"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const id = bridge.configured ? bridge.applicationId : appId.trim();
              if (await call("", { method: "PUT", body: JSON.stringify({ applicationId: id, botToken: token.trim() }) })) setToken("");
            })
          }
        >
          {bridge.configured ? "Reconnect" : "Connect"}
        </Button>
      </div>
    </div>
  );

  const intents = (
    <>
      Under Bot, turn on <strong>Message Content Intent</strong> and <strong>Server Members Intent</strong>.
    </>
  );

  let at = 0;
  if (bridge.configured) {
    if (bridge.status !== "linked") at = 1;
    else if (bridge.copy.status === "idle") at = 2;
    else if (bridge.copy.status === "done") at = 4;
    else at = 3;
  }

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <DiscordLogo size={20} color="#5865F2" />
        <h2 className="m-0 text-base font-semibold">Discord</h2>
      </div>
      <span className="text-sm text-gryt-muted">
        Link one Discord server to this one. Messages, replies, reactions, pins and threads show up on both sides, matched message for message.
      </span>
      <StepBar at={at} />
    </div>
  );

  const unlinkBlock = (
    <div className="flex flex-col gap-2 border-t border-gryt-border pt-4">
      <span className="text-sm font-medium">Unlink Discord</span>
      <span className="text-sm text-gryt-muted">Stops the bridge and logs the bot out. Everything already copied stays here.</span>
      <div className="flex gap-2">
        {confirmUnlink ? (
          <>
            <Button size="small" tone="danger" disabled={busy} onClick={() => void act(async () => { await call("", { method: "DELETE" }); setConfirmUnlink(false); })}>Unlink</Button>
            <Button size="small" tone="ghost" onClick={() => setConfirmUnlink(false)}>Cancel</Button>
          </>
        ) : (
          <Button size="small" tone="ghost" onClick={() => setConfirmUnlink(true)}>Unlink…</Button>
        )}
      </div>
    </div>
  );

  if (!bridge.configured) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Surface className="flex flex-col gap-2 p-4">
          <span className="text-sm font-medium">Make a Discord app for this server</span>
          <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-sm text-gryt-muted">
            <li>
              Open the{" "}
              <a className="gryt-link" href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer">
                Discord Developer Portal
              </a>{" "}
              and make a new application. Call it what the bot should be called.
            </li>
            <li>{intents}</li>
            <li>Copy the application ID and the bot token into the boxes below.</li>
          </ol>
        </Surface>
        {tokenForm("Bot token")}
      </div>
    );
  }

  const guildName = bridge.guild?.name ?? "your Discord server";

  return (
    <div className="flex flex-col gap-5">
      {header}

      {bridge.status === "connecting" && (
        <div className="flex items-center gap-2 text-sm text-gryt-muted">
          <Spinner size={14} /> Connecting to Discord…
        </div>
      )}

      {bridge.status === "token_invalid" && (
        <Surface className="flex flex-col gap-3 p-4">
          <span className="text-sm font-medium">Discord says the bot&rsquo;s token doesn&rsquo;t work any more</span>
          <span className="text-sm text-gryt-muted">
            That happens when the app is deleted or its token is reset. Make a new token under Bot in the Developer Portal, or a new app if this one is gone, and paste it here.
          </span>
          {tokenForm("New bot token")}
        </Surface>
      )}

      {bridge.status === "intents_missing" && (
        <Surface className="flex flex-col gap-3 p-4">
          <span className="text-sm font-medium">An intent the bot needs is off</span>
          <span className="text-sm text-gryt-muted">{intents} Then press Reconnect.</span>
          {tokenForm("Bot token")}
        </Surface>
      )}

      {(bridge.status === "waiting_for_invite" || bridge.status === "removed") && (
        <Surface className="flex flex-col gap-3 p-4">
          <span className="text-sm font-medium">
            {bridge.status === "removed" ? `The bot was removed from ${guildName}` : "Add the bot to your Discord server"}
          </span>
          <span className="text-sm text-gryt-muted">
            You need Manage Server there. The link asks only for what the bot uses: reading and sending messages, webhooks, reactions, pins and threads. Not Administrator.
          </span>
          <div className="flex flex-wrap gap-2">
            <a className="gryt-button inline-flex min-h-9 items-center gap-2 rounded-(--gryt-radius-control) bg-gryt-accent px-4 text-sm font-semibold text-gryt-on-accent no-underline" href={bridge.inviteUrl} target="_blank" rel="noopener noreferrer">
              <DiscordLogo size={16} /> Open invite link
            </a>
            <Button size="small" tone="ghost" onClick={() => void copyInvite(bridge.inviteUrl)}>Copy link</Button>
          </div>
          <span className="flex items-center gap-2 text-sm text-gryt-muted">
            <Spinner size={14} /> Waiting for the bot to join…
          </span>
        </Surface>
      )}

      {bridge.status === "linked" && bridge.copy.status === "idle" && (
        <Setup
          host={host}
          guild={bridge.guild}
          members={members}
          excluded={bridge.excludedMembers ?? []}
          syncNewChannels={bridge.syncNewChannels ?? true}
          busy={busy}
          refresh={() => void call("")}
          onNewChannels={(on) => void call("/settings", { method: "PUT", body: JSON.stringify({ syncNewChannels: on }) })}
          onStart={(direction, identity) => void act(async () => { await call("/copy", { method: "POST", body: JSON.stringify({ direction, identity }) }); })}
        />
      )}

      {bridge.status === "linked" && (bridge.copy.status === "running" || bridge.copy.status === "paused" || bridge.copy.status === "failed") && (
        <Copying
          guildName={guildName}
          status={bridge.copy.status}
          progress={bridge.copy.progress}
          busy={busy}
          onPause={(paused) => void act(async () => { await call("/copy/pause", { method: "POST", body: JSON.stringify({ paused }) }); })}
          onRetry={() => void act(async () => { await call("/copy", { method: "POST", body: JSON.stringify({ direction: bridge.direction ?? "both" }) }); })}
        />
      )}

      {bridge.status === "linked" && bridge.copy.status === "done" && (
        <Live
          host={host}
          guild={bridge.guild}
          direction={bridge.direction ?? "both"}
          stats={bridge.stats ?? null}
          syncOff={bridge.syncOff ?? []}
          syncNewChannels={bridge.syncNewChannels ?? true}
          members={members}
          excluded={bridge.excludedMembers ?? []}
          refresh={() => void call("")}
          onSettings={(body) => void call("/settings", { method: "PUT", body: JSON.stringify(body) })}
        />
      )}

      {unlinkBlock}
    </div>
  );
}

type SetupPage = "which" | "channels" | "members" | "start";

/** Step 3. An empty server just becomes a copy, so it skips matching channels and choosing a name. */
function Setup({
  host, guild, members, excluded, syncNewChannels, busy, refresh, onNewChannels, onStart,
}: {
  host: string;
  guild: Guild | null;
  members: Member[];
  excluded: string[];
  syncNewChannels: boolean;
  busy: boolean;
  refresh: () => void;
  onNewChannels: (on: boolean) => void;
  onStart: (direction: Direction, identity: boolean) => void;
}) {
  const preview = usePreview(host);
  const matches = useChannelMatches(host);
  const people = usePeople(host);
  const [page, setPage] = useState<SetupPage>("which");
  const [direction, setDirection] = useState<Direction>("both");
  const [identity, setIdentity] = useState<boolean | null>(null);
  if (!preview) return <Spinner />;

  const empty = !preview.hasMessages;
  const sends = direction !== "to_gryt";
  const pages: SetupPage[] = empty ? ["which", "members", "start"] : ["which", "channels", "members", "start"];
  const index = pages.indexOf(page);
  const next = () => setPage(pages[index + 1]);
  const back = index > 0 ? <Button size="small" tone="ghost" onClick={() => setPage(pages[index - 1])}>Back</Button> : null;
  const linkedMatches = matches.channels?.filter((d) => matches.picks[d.id] !== "skip").length ?? 0;

  const start = () =>
    void (async () => {
      if (await matches.save()) onStart(direction, empty || identity === true);
    })();

  return (
    <div className="flex flex-col gap-4">
      <GuildCard guild={guild} line={guildLine(guild)} />

      {page === "which" && (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Which way</span>
            <RadioGroup value={direction} onValueChange={(v) => setDirection(v as Direction)}>
              {DIRECTIONS.map((d) => (
                <label key={d.value} className="flex items-start gap-2 text-sm">
                  <Radio value={d.value} />
                  <span className="flex flex-col">
                    <span className="font-medium">{d.label}</span>
                    <span className="text-gryt-muted">{d.hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            <span className="text-xs text-gryt-muted">You can change this later in the Live step.</span>
          </div>
          <div className="flex gap-2"><Button size="small" onClick={next}>{empty ? "Next: people" : "Next: channels"}</Button></div>
        </>
      )}

      {page === "channels" && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Match the channels</span>
            <span className="text-sm text-gryt-muted">
              We guessed matches by name, ignoring emoji, dashes and words like &ldquo;chat&rdquo;. Check them, then change any that are wrong. Each Discord channel goes to one channel here, and a matched channel moves into its Discord folder.
            </span>
          </div>
          <ChannelMatches matches={matches} />
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={syncNewChannels} onCheckedChange={onNewChannels} />
            <span className="flex flex-col">
              <span className="font-medium">Sync new Discord channels</span>
              <span className="text-gryt-muted">Off, and a channel made on Discord later is left out until you add it here.</span>
            </span>
          </label>
          <div className="flex gap-2">{back}<Button size="small" onClick={next}>Next: people</Button></div>
        </>
      )}

      {page === "members" && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Link existing members</span>
            <span className="text-sm text-gryt-muted">
              Someone who&rsquo;s on both? Pick their member here and their Discord messages show under that member. Skip anyone you&rsquo;re not sure about: they can link themselves later with /link on the bot. Switch someone off and nothing of theirs is copied.
            </span>
          </div>
          <DiscordPeople people={people} members={members} />
          {sends && <MembersToDiscord host={host} members={members} excluded={excluded} onChange={refresh} />}
          <div className="flex gap-2">{back}<Button size="small" onClick={next}>Next</Button></div>
        </>
      )}

      {page === "start" && (
        <>
          {empty ? (
            <Surface className="flex flex-col gap-2 p-4 text-sm">
              <span className="font-medium">What comes over</span>
              <span className="text-gryt-muted">This server is still empty, so it becomes a copy of {guild?.name ?? "the Discord server"}.</span>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                <li>✓ Name and picture: &ldquo;{preview.name ?? "this server"}&rdquo; becomes {guild?.name ?? "the Discord name"}</li>
                <li>✓ {preview.roles} roles, with names and colours. People get theirs when they&rsquo;re linked.</li>
                <li>✓ {linkedMatches} channels, with names, topics, folders and order. Voice channels too, without the voice.</li>
                {preview.emoji > 0 && <li>✓ {preview.emoji} custom emoji</li>}
                <li>✓ Every message, back to the first one, with replies, reactions, pins, threads and files</li>
              </ul>
            </Surface>
          ) : (
            <Surface className="flex flex-col gap-3 p-4 text-sm">
              <span className="font-medium">Before you start</span>
              <div className="flex flex-col gap-2">
                <span className="font-medium">Name and icon</span>
                <span className="text-gryt-muted">Keep &ldquo;{preview.name ?? "this server"}&rdquo;, or take {guild?.name ?? "the Discord server"}&rsquo;s name and icon.</span>
                <RadioGroup value={identity === true ? "theirs" : "mine"} onValueChange={(v) => setIdentity(v === "theirs")}>
                  <label className="flex items-center gap-2"><Radio value="mine" /> Keep mine</label>
                  <label className="flex items-center gap-2"><Radio value="theirs" /> Use Discord&rsquo;s</label>
                </RadioGroup>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-medium">Copy the history</span>
                <span className="text-gryt-muted">Every Discord message back to the first one, with files and reactions. It slots in by date around the messages already here. Messages from before today don&rsquo;t go to Discord.</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-medium">Custom emoji</span>
                <span className="text-gryt-muted">
                  {preview.emoji === 0 ? "The Discord server has none." : `${preview.emoji} come over.`}
                  {preview.emojiClashes.length > 0 && ` ${preview.emojiClashes.length} share a name with yours (${preview.emojiClashes.map((n) => `:${n}:`).join(", ")}), so those stay as yours and Discord's aren't copied.`}
                </span>
              </div>
            </Surface>
          )}
          <span className="text-sm text-gryt-muted">Big servers take a while. It runs on the server, so you can close this while it copies.</span>
          <div className="flex gap-2">{back}<Button size="small" disabled={busy} onClick={start}>{empty ? "Start copying" : "Start linking"}</Button></div>
        </>
      )}
    </div>
  );
}

function channelState(c: { name: string; messages: number; done: boolean }, current: string | null | undefined): string {
  if (c.done) return `Done · ${c.messages.toLocaleString()} messages`;
  return current === c.name ? "Copying…" : "Waiting";
}

/** Step 4: each channel's count as it goes. */
function Copying({ guildName, status, progress, busy, onPause, onRetry }: {
  guildName: string;
  status: "running" | "paused" | "failed";
  progress: CopyProgress | null;
  busy: boolean;
  onPause: (paused: boolean) => void;
  onRetry: () => void;
}) {
  const channels = progress?.channels ?? [];
  return (
    <Surface className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-medium">{status === "paused" ? `Copying ${guildName} is paused` : `Copying ${guildName}`}</span>
        {status !== "failed" && (
          <Button size="small" tone="ghost" disabled={busy} onClick={() => onPause(status === "running")}>{status === "running" ? "Pause" : "Resume"}</Button>
        )}
      </div>
      <span className="text-sm text-gryt-muted">It runs on the server, so you can close this. New messages already come through live.</span>
      {progress && status === "running" && (
        <Progress value={progress.channels_total ? (progress.channels_done / progress.channels_total) * 100 : null} aria-label="Channels copied" />
      )}
      {channels.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          {channels.map((c) => (
            <div key={c.name} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">#{c.name}</span>
              <span className="text-gryt-muted">
                {channelState(c, progress?.current_channel)}
              </span>
            </div>
          ))}
        </div>
      )}
      {progress && (
        <span className="text-xs text-gryt-muted">
          {progress.messages_imported.toLocaleString()} messages and {progress.files_stored.toLocaleString()} files so far. Discord lets a bot read 100 messages at a time and slows it down past that, so a big server copies at its own pace.
        </span>
      )}
      {status === "failed" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gryt-muted">The copy stopped partway. Starting it again picks up where it left off.</span>
          <Button size="small" disabled={busy} onClick={onRetry}>Try again</Button>
        </div>
      )}
    </Surface>
  );
}

/** Step 5. Everything here can be changed while the bridge runs, and only affects what happens next. */
function Live({ host, guild, direction, stats, syncOff, syncNewChannels, members, excluded, refresh, onSettings }: {
  host: string;
  guild: Guild | null;
  direction: Direction;
  stats: { messagesMatched: number; lastMessageAt: string | null } | null;
  syncOff: string[];
  syncNewChannels: boolean;
  members: Member[];
  excluded: string[];
  refresh: () => void;
  onSettings: (body: { syncOff?: string[]; syncNewChannels?: boolean; direction?: Direction }) => void;
}) {
  const matches = useChannelMatches(host);
  const people = usePeople(host);
  const [editing, setEditing] = useState(false);
  const linked = matches.channels?.filter((d) => matches.picks[d.id] !== "skip").length ?? 0;
  const skipped = (matches.channels?.length ?? 0) - linked;
  const line = [
    `Live · ${DIRECTION_LABEL[direction]}`,
    `${linked} channels`,
    ago(stats?.lastMessageAt ?? null),
    `${(stats?.messagesMatched ?? 0).toLocaleString()} messages matched`,
  ].join(" · ");

  return (
    <div className="flex flex-col gap-5">
      <GuildCard guild={guild} line={line} />

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Which way</span>
        <RadioGroup value={direction} onValueChange={(v) => onSettings({ direction: v as Direction })}>
          {DIRECTIONS.map((d) => (
            <label key={d.value} className="flex items-center gap-2 text-sm">
              <Radio value={d.value} /> {d.label}
            </label>
          ))}
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">What crosses over</span>
        <SyncKinds off={syncOff} onChange={(off) => onSettings({ syncOff: off })} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm">
            <span className="font-medium">Channels</span>{" "}
            <span className="text-gryt-muted">· {linked} linked, {skipped} skipped</span>
          </span>
          <Button size="small" tone="ghost" onClick={() => setEditing((e) => !e)}>{editing ? "Close" : "Edit matches"}</Button>
        </div>
        <span className="text-sm text-gryt-muted">Change a match any time. New messages follow it right away; history is only copied again if you ask.</span>
        {editing && (
          <>
            <ChannelMatches matches={matches} />
            <div>
              <Button size="small" onClick={() => void (async () => { if (await matches.save()) { toast.success("Channel matches saved"); setEditing(false); } })()}>Save matches</Button>
            </div>
          </>
        )}
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={syncNewChannels} onCheckedChange={(on) => onSettings({ syncNewChannels: on })} />
          <span className="flex flex-col">
            <span className="font-medium">Sync new Discord channels</span>
            <span className="text-gryt-muted">Off, and a channel made on Discord later is left out until you add it here.</span>
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">People</span>
        <span className="text-sm text-gryt-muted">
          Link a Discord account to a member here, and their messages show under their own name on both sides. Until then they show with their Discord name and a Discord badge.
        </span>
        <DiscordPeople people={people} members={members} />
      </div>

      {direction !== "to_gryt" && <MembersToDiscord host={host} members={members} excluded={excluded} onChange={refresh} />}
    </div>
  );
}
