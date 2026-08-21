import { Button, IconButton, Surface, Switch } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { PiCopyBold, PiTrashBold } from "react-icons/pi";
import type { Socket } from "socket.io-client";

import { useSocketEvent } from "../hooks/useSocketEvent";
import { describePermission } from "../lib/permissions";

type BotStatus = "pending" | "approved" | "denied";

type BotEntry = {
  registrationId: string;
  botId: string | null;
  nickname: string;
  description: string | null;
  requested: string[];
  granted: string[];
  rank: number;
  status: BotStatus;
  awaitingClaim: boolean;
  createdAt: string | Date;
  decidedAt: string | Date | null;
};

/**
 * Bots, and what they have been allowed to do.
 *
 * The screen is built around one idea: **you are agreeing to a list, and the
 * list is the bot's, not yours.** A bot says what it wants when it turns up;
 * every permission here is one it asked for, and there is no way to add to
 * that from this side. Ticking fewer is always available, and usually right.
 *
 * That constraint is the reason a compromised bot cannot talk its way into
 * more later — it can ask again all it likes, and the server hands back the
 * question it asked the first time.
 */
export function ServerBotsTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  const [bots, setBots] = useState<BotEntry[] | null>(null);
  const [policy, setPolicy] = useState<"request" | "disabled">("disabled");
  const [ticked, setTicked] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ nickname: string; token: string } | null>(null);

  const refresh = () => {
    if (!socket?.connected || !accessToken) return;
    socket.emit("server:bots:list", { accessToken });
  };

  useSocketEvent<{ bots: BotEntry[]; policy: "request" | "disabled" }>(
    socket,
    "server:bots",
    (payload) => {
    const list = Array.isArray(payload?.bots) ? payload.bots : [];
    setBots(list);
    setPolicy(payload?.policy === "request" ? "request" : "disabled");
    setBusy(false);
    // Everything a pending bot asked for starts ticked. The operator is being
    // asked to take things away, which is the direction that makes the shorter
    // grant the easy one rather than the diligent one.
    setTicked((prev) => {
      const next = { ...prev };
      for (const b of list) {
        if (b.status === "pending" && !next[b.registrationId]) {
          next[b.registrationId] = new Set(b.requested);
        }
      }
      return next;
    });
    },
  );

  useSocketEvent<{ claimToken: string; nickname: string }>(
    socket,
    "server:bot:registered",
    (payload) => {
      if (!payload?.claimToken) return;
      // Shown once and never again — the server does not include it in the
      // list, so there is nowhere to go back and read it.
      setIssued({ nickname: payload.nickname, token: payload.claimToken });
    },
  );

  useEffect(() => {
    if (!host || !socket?.connected || !accessToken) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected, accessToken]);

  const emit = (event: string, payload: Record<string, unknown>) => {
    if (!socket?.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    setBusy(true);
    socket.emit(event, { accessToken, ...payload });
  };

  const toggle = (registrationId: string, permission: string, on: boolean) => {
    setTicked((prev) => {
      const set = new Set(prev[registrationId] ?? []);
      if (on) set.add(permission);
      else set.delete(permission);
      return { ...prev, [registrationId]: set };
    });
  };

  const pending = useMemo(() => (bots ?? []).filter((b) => b.status === "pending"), [bots]);
  const settled = useMemo(() => (bots ?? []).filter((b) => b.status !== "pending"), [bots]);

  if (!bots) {
    return <span className="text-sm text-gryt-muted">Loading bots…</span>;
  }

  return (
    <div className="flex flex-col gap-6">
      <span className="text-sm text-gryt-muted">
        A bot is a member like any other — it holds only what you give it, and it can never
        give itself more. What it asked for is fixed the first time it turns up, so a bot
        that has been tampered with since cannot come back asking for the keys.
      </span>

      <Surface>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-col" style={{ maxWidth: "34rem" }}>
            <span className="text-sm font-bold">Let bots ask to join</span>
            <span className="text-xs text-gryt-muted">
              With this on, a bot that knows the address can leave a request here. It is
              admitted by nothing — it waits until you answer. Turn it off and the only way
              in is a token you hand out yourself.
            </span>
          </div>
          <Switch
            checked={policy === "request"}
            disabled={busy}
            onCheckedChange={(on: boolean) =>
              emit("server:bots:policy:set", { policy: on ? "request" : "disabled" })
            }
          />
        </div>
      </Surface>

      {issued && (
        <Surface>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold">{issued.nickname} is ready to be deployed</span>
            <span className="text-xs text-gryt-muted">
              This is the only time you will see this token. Put it in the container's
              environment as <code>GRYT_BOT_TOKEN</code>. The first bot to use it becomes this
              registration; after that it stops working.
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs" style={{ wordBreak: "break-all" }}>{issued.token}</code>
              <IconButton
                tone="neutral"
                size="xsmall"
                aria-label="Copy token"
                onClick={() => {
                  navigator.clipboard.writeText(issued.token).then(
                    () => toast.success("Copied"),
                    () => toast.error("Could not copy"),
                  );
                }}
              >
                <PiCopyBold size={14} />
              </IconButton>
              <Button tone="ghost" size="xsmall" onClick={() => setIssued(null)}>
                I have it
              </Button>
            </div>
          </div>
        </Surface>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-bold">Waiting for an answer</span>
          <span className="text-xs text-gryt-muted">
            Bots that turned up and asked to join. They can do nothing until you say so.
          </span>
        </div>

        {pending.length === 0 ? (
          <span className="text-sm text-gryt-muted">Nothing waiting.</span>
        ) : (
          pending.map((bot) => {
            const chosen = ticked[bot.registrationId] ?? new Set<string>();
            return (
              <Surface key={bot.registrationId}>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold">{bot.nickname}</span>
                    {bot.description && (
                      <span className="text-xs text-gryt-muted">{bot.description}</span>
                    )}
                    <span className="text-xs text-gryt-muted" style={{ wordBreak: "break-all" }}>
                      {bot.botId}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-gryt-muted">
                      It is asking for {bot.requested.length}
                      {bot.requested.length === 1 ? " permission" : " permissions"}. Untick
                      anything you would rather it did not have — you cannot add to this list.
                    </span>
                    {bot.requested.length === 0 ? (
                      <span className="text-sm text-gryt-muted">
                        Nothing at all. It only wants to be here.
                      </span>
                    ) : (
                      bot.requested.map((permission) => {
                        const meta = describePermission(permission);
                        return (
                          <label
                            key={permission}
                            className="flex items-start gap-2 text-sm"
                            style={{ cursor: "pointer" }}
                          >
                            <input
                              type="checkbox"
                              checked={chosen.has(permission)}
                              onChange={(e) => toggle(bot.registrationId, permission, e.target.checked)}
                              style={{ marginTop: "0.3em" }}
                            />
                            <span className="flex flex-col">
                              <span>{meta.label}</span>
                              {meta.description && (
                                <span className="text-xs text-gryt-muted">{meta.description}</span>
                              )}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      tone="neutral"
                      size="small"
                      disabled={busy}
                      onClick={() => emit("server:bots:decide", { botId: bot.botId, decision: "denied" })}
                    >
                      Turn away
                    </Button>
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() =>
                        emit("server:bots:decide", {
                          botId: bot.botId,
                          decision: "approved",
                          permissions: [...chosen],
                        })
                      }
                    >
                      Let it in with {chosen.size}
                    </Button>
                  </div>
                </div>
              </Surface>
            );
          })
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-bold">Set one up in advance</span>
          <span className="text-xs text-gryt-muted">
            For a bot that has to start on its own — in a compose file, or from CI. Decide what
            it may do now, and hand the token to whoever deploys it.
          </span>
        </div>
        <RegisterBot busy={busy} onCreate={(nickname) => emit("server:bots:register", { nickname, permissions: [] })} />
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-bold">Answered</span>
        {settled.length === 0 ? (
          <span className="text-sm text-gryt-muted">No bots yet.</span>
        ) : (
          settled.map((bot) => (
            <Surface key={bot.registrationId}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold">
                    {bot.nickname}{" "}
                    <span className="text-xs text-gryt-muted">
                      {bot.status === "approved" ? "· allowed" : "· turned away"}
                      {bot.awaitingClaim ? " · waiting to be deployed" : ""}
                    </span>
                  </span>
                  <span className="text-xs text-gryt-muted">
                    {bot.granted.length > 0
                      ? bot.granted.map((p) => describePermission(p).label).join(", ")
                      : "Can do nothing"}
                  </span>
                </div>
                <IconButton
                  tone="danger"
                  size="xsmall"
                  aria-label="Withdraw this bot"
                  disabled={busy}
                  onClick={() => emit("server:bots:revoke", { registrationId: bot.registrationId })}
                >
                  <PiTrashBold size={14} />
                </IconButton>
              </div>
            </Surface>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Naming a bot that does not exist yet.
 *
 * Created with no permissions on purpose. The operator can widen it afterwards
 * only as far as it was registered for — and starting at nothing means a
 * half-filled form leaves a bot that can do nothing rather than one that can do
 * whatever was left ticked.
 */
function RegisterBot({ busy, onCreate }: { busy: boolean; onCreate: (nickname: string) => void }) {
  const [nickname, setNickname] = useState("");

  return (
    <Surface>
      <div className="flex items-end gap-2 flex-wrap">
        <label className="flex flex-col gap-1 text-sm" style={{ flex: "1 1 12rem" }}>
          <span className="text-gryt-muted text-xs">What should it be called?</span>
          <input
            value={nickname}
            maxLength={32}
            placeholder="Deploybot"
            onChange={(e) => setNickname(e.target.value)}
            className="bg-transparent border-b border-gryt-border outline-none"
          />
        </label>
        <Button
          size="small"
          disabled={busy || !nickname.trim()}
          onClick={() => {
            onCreate(nickname.trim());
            setNickname("");
          }}
        >
          Create token
        </Button>
      </div>
    </Surface>
  );
}
