import { Avatar, Button, Chip, Meter } from "@gryt/ui";
import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";

import { GeneratedServerIcon, getServerHttpBase } from "@/common";

import type { CloudUsage } from "../../../../lib/useCloudUsage";
import { useOpenInviteLink } from "../hooks/useOpenInviteLink";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { formatFileSize } from "../utils/formatFileSize";
import type { MemberInfo } from "./MemberSidebar";
import { ask, type StorageOverview } from "./storage/storageApi";

function Label({ children }: { children: string }) {
  return <div className="text-[11px] font-semibold tracking-[0.08em] text-gryt-muted uppercase">{children}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--gryt-radius-surface)] border border-gryt-border bg-gryt-surface px-4 py-3">
      <Label>{label}</Label>
      <span className="text-2xl font-bold">{value}</span>
    </div>
  );
}

function Usage({ label, used, limit }: { label: string; used: number | null; limit?: number }) {
  const pct = used == null || !limit ? 0 : Math.min(100, (used / limit) * 100);
  const tone = pct >= 90 ? "danger" : "primary";
  return (
    <div className="flex flex-col gap-2 rounded-[var(--gryt-radius-surface)] border border-gryt-border bg-gryt-surface p-4">
      <Label>{label}</Label>
      {limit ? <Meter value={pct} aria-label={label} tone={pct >= 75 && pct < 90 ? "warning" : tone} /> : null}
      <div className="flex justify-between text-sm">
        <strong>{used == null ? "Not counted yet" : formatFileSize(used)}</strong>
        {limit ? <span className="text-gryt-muted">of {formatFileSize(limit)}</span> : null}
      </div>
    </div>
  );
}

/** The first screen of server settings: what the server is, how full, and what needs the owner. */
export function ServerHomeTab({
  host,
  name,
  socket,
  accessToken,
  members,
  cloudUsage,
  has,
  onGo,
}: {
  host: string;
  name: string;
  socket: Socket | undefined;
  accessToken: string | null;
  members: MemberInfo[];
  cloudUsage: CloudUsage | null;
  has: (permission: string) => boolean;
  onGo: (tab: string) => void;
}) {
  const invite = useOpenInviteLink(host);
  const [messages, setMessages] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [reports, setReports] = useState(0);
  const [storage, setStorage] = useState<StorageOverview | null>(null);

  useSocketEvent<{ messageCount?: number }>(socket, "server:settings", (s) => {
    if (typeof s.messageCount === "number") setMessages(s.messageCount);
  });
  useSocketEvent<{ requests?: { id?: string }[] }>(socket, "server:joinRequests", (p) => setWaiting(p.requests?.length ?? 0));
  useSocketEvent<{ reports?: { id?: string }[]; userReports?: { id?: string }[] }>(socket, "reports:list", (p) =>
    setReports((p.reports?.length ?? 0) + (p.userReports?.length ?? 0)),
  );

  const canRequests = has("manage_join_requests");
  const canReports = has("view_reports");
  const canStorage = has("manage_server");
  useEffect(() => {
    if (!socket) return;
    socket.emit("server:settings:get");
    if (canRequests) socket.emit("server:joinRequests:list", { accessToken });
    if (canReports) socket.emit("reports:list", { accessToken });
    if (!cloudUsage && canStorage) ask<StorageOverview>(socket, "storage:overview", {}).then(setStorage).catch(() => {});
  }, [socket, accessToken, cloudUsage, canRequests, canReports, canStorage]);

  const online = members.filter((m) => m.status !== "offline").length;
  const needs = [
    waiting > 0 && { t: `${waiting} waiting to join`, v: "Let them in from Members", tab: "members", action: "Review" },
    reports > 0 && { t: `${reports} open ${reports === 1 ? "report" : "reports"}`, v: "In Moderation", tab: "moderation", action: "Open" },
  ].filter(Boolean) as { t: string; v: string; tab: string; action: string }[];

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar size="large" className="h-16 w-16" src={`${getServerHttpBase(host)}/icon`} fallback={<GeneratedServerIcon seed={name || host} />} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-2xl font-bold">{name}</span>
          <span className="truncate font-mono text-sm text-gryt-muted">{host}</span>
        </span>
        {cloudUsage && <Chip tone="primary">{cloudUsage.plan.name} plan</Chip>}
        <Button size="large" onClick={() => (invite.available ? void invite.copy() : onGo("invites"))}>
          Invite a friend
        </Button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
        <Stat label="Members" value={String(members.length)} />
        {messages != null && <Stat label="Messages" value={messages.toLocaleString("en-GB").replace(/,/g, " ")} />}
        <Stat label="Online now" value={String(online)} />
      </div>

      {(cloudUsage || storage) && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
          {cloudUsage ? (
            <>
              <Usage label="Storage" used={cloudUsage.storage.used} limit={cloudUsage.storage.limit} />
              <Usage label="Transfer this month" used={cloudUsage.transfer.sent} />
            </>
          ) : (
            storage && <Usage label="Storage" used={storage.used} limit={storage.limit ?? undefined} />
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label>Needs you</Label>
        {needs.length === 0 ? (
          <span className="text-sm text-gryt-muted">Nothing needs you right now.</span>
        ) : (
          <div className="overflow-hidden rounded-[var(--gryt-radius-surface)] border border-gryt-border bg-gryt-surface">
            {needs.map((n, i) => (
              <div key={n.tab} className={`flex items-center gap-3 px-4 py-3 ${i ? "border-t border-gryt-border" : ""}`}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-bold">{n.t}</span>
                  <span className="text-xs text-gryt-muted">{n.v}</span>
                </span>
                <Button size="small" tone="neutral" onClick={() => onGo(n.tab)}>
                  {n.action}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
