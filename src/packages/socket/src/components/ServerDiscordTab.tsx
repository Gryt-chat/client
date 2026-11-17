import { Button, Progress, Radio, RadioGroup, Spinner, Surface, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken, getServerHttpBase } from "@/common";

import { DiscordLogo } from "../../../../lib/icons";

type Status = "connecting" | "token_invalid" | "intents_missing" | "waiting_for_invite" | "linked" | "removed";
type Direction = "to_gryt" | "both" | "to_discord";

interface Progress {
  channels_total: number;
  channels_done: number;
  messages_imported: number;
  files_stored: number;
  current_channel?: string | null;
}

type Bridge =
  | { configured: false }
  | {
      configured: true;
      applicationId: string;
      status: Status;
      guild: { id: string; name: string | null } | null;
      inviteUrl: string;
      direction: Direction | null;
      copy: { status: "idle" | "running" | "done" | "failed"; progress: Progress | null };
    };

const DIRECTIONS: { value: Direction; label: string; hint: string }[] = [
  { value: "to_gryt", label: "Discord → Gryt", hint: "Copy it all here and keep new messages coming. Discord stays the main place." },
  { value: "both", label: "Both ways", hint: "Same channels and messages on both sides. Whatever happens on one shows up on the other." },
  { value: "to_discord", label: "Gryt → Discord", hint: "Post what's said here into Discord, for people who haven't moved yet." },
];

const DIRECTION_LABEL: Record<Direction, string> = { to_gryt: "Discord → Gryt", both: "both ways", to_discord: "Gryt → Discord" };

/** Owner only, like the server's routes: the bridge writes as other people. */
export function ServerDiscordTab({ host }: { host: string }) {
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [appId, setAppId] = useState("");
  const [token, setToken] = useState("");
  const [direction, setDirection] = useState<Direction>("both");
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

  const startCopy = () =>
    act(async () => {
      await call("/copy", { method: "POST", body: JSON.stringify({ direction }) });
    });
  const unlink = () =>
    act(async () => {
      await call("", { method: "DELETE" });
      setConfirmUnlink(false);
    });
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

  const header = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <DiscordLogo size={20} color="#5865F2" />
        <h2 className="m-0 text-base font-semibold">Discord</h2>
      </div>
      <span className="text-sm text-gryt-muted">
        Link one Discord server to this one. Messages, replies, reactions, pins and threads come across, matched message for message.
      </span>
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
            <li>Under Bot, turn on Message Content Intent.</li>
            <li>Copy the application ID and the bot token into the boxes below.</li>
          </ol>
        </Surface>
        {tokenForm("Bot token")}
      </div>
    );
  }

  const guildName = bridge.guild?.name ?? "your Discord server";
  const progress = bridge.copy.progress;

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
          <span className="text-sm font-medium">Discord says the bot's token doesn't work any more</span>
          <span className="text-sm text-gryt-muted">
            That happens when the app is deleted or its token is reset. Make a new token under Bot in the Developer Portal, or a new app if this one is gone, and paste it here.
          </span>
          {tokenForm("New bot token")}
        </Surface>
      )}

      {bridge.status === "intents_missing" && (
        <Surface className="flex flex-col gap-3 p-4">
          <span className="text-sm font-medium">Message Content Intent is off</span>
          <span className="text-sm text-gryt-muted">
            Without it the bot can't read messages. Turn it on under Bot in the Developer Portal, then press Reconnect.
          </span>
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
        <div className="flex flex-col gap-4">
          <Surface className="p-4 text-sm">
            The bot is in <strong>{guildName}</strong>.
          </Surface>
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
          </div>
          <span className="text-sm text-gryt-muted">
            Every channel comes across with its whole history, files and threads. Big servers take a while, and you can close this while it runs.
          </span>
          <div>
            <Button size="small" disabled={busy} onClick={() => void startCopy()}>Start copying</Button>
          </div>
        </div>
      )}

      {bridge.status === "linked" && bridge.copy.status !== "idle" && (
        <Surface className="flex flex-col gap-3 p-4">
          <span className="text-sm font-medium">
            {guildName} · {bridge.copy.status === "running" ? "copying" : `live, ${DIRECTION_LABEL[bridge.direction ?? "both"]}`}
          </span>
          {progress && (
            <>
              {bridge.copy.status === "running" && (
                <Progress value={progress.channels_total ? (progress.channels_done / progress.channels_total) * 100 : null} aria-label="Channels copied" />
              )}
              <span className="text-sm text-gryt-muted">
                {progress.channels_done} of {progress.channels_total} channels · {progress.messages_imported.toLocaleString()} messages · {progress.files_stored.toLocaleString()} files
                {bridge.copy.status === "running" && progress.current_channel ? ` · now #${progress.current_channel}` : ""}
              </span>
            </>
          )}
          {bridge.copy.status === "failed" && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gryt-muted">The copy stopped partway. Starting it again picks up where it left off.</span>
              <Button size="small" disabled={busy} onClick={() => void startCopy()}>Try again</Button>
            </div>
          )}
        </Surface>
      )}

      <div className="flex flex-col gap-2 border-t border-gryt-border pt-4">
        <span className="text-sm font-medium">Unlink Discord</span>
        <span className="text-sm text-gryt-muted">Stops the bridge and logs the bot out. Everything already copied stays here.</span>
        <div className="flex gap-2">
          {confirmUnlink ? (
            <>
              <Button size="small" tone="danger" disabled={busy} onClick={() => void unlink()}>Unlink</Button>
              <Button size="small" tone="ghost" onClick={() => setConfirmUnlink(false)}>Cancel</Button>
            </>
          ) : (
            <Button size="small" tone="ghost" onClick={() => setConfirmUnlink(true)}>Unlink…</Button>
          )}
        </div>
      </div>
    </div>
  );
}
