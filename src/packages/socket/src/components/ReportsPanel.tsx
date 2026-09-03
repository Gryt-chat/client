import { AlertDialog, Button, Chip, Dialog, IconButton, ScrollArea, Spinner, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { PiBootFill, PiCheck, PiProhibitFill, PiTrashFill, PiWarningCircle, PiWarningFill } from "react-icons/pi";
import type { Socket } from "socket.io-client";

import { getServerAccessToken, getUploadsFileUrl } from "@/common";

import { useServerPermissions } from "../hooks/usePermissions";
import type { AttachmentMeta } from "./chatUtils";
import { FileCard } from "./FileCard";
import { ImageLightbox } from "./ImageLightbox";

/**
 * A person somebody reported, with every open report about them folded in.
 *
 * One card per person rather than per report, so a queue does not fill with
 * six rows when six people report the same person on the same evening. The
 * reasons are all here because they are the only evidence: unlike a message
 * report there is nothing else attached.
 */
export interface AggregatedUserReport {
  reportedServerUserId: string;
  reportedNickname: string | null;
  reportCount: number;
  reporters: string[];
  reasons: Array<{
    reporterServerUserId: string;
    /** Snapshotted server-side, so it survives the reporter leaving. */
    reporterNickname: string | null;
    reason: string;
    createdAt: string;
  }>;
  firstReportedAt: string;
  reportIds: string[];
}

export interface AggregatedReport {
  messageId: string;
  conversationId: string;
  messageText: string | null;
  attachments: string[] | null;
  enrichedAttachments: AttachmentMeta[] | null;
  senderServerUserId: string;
  senderNickname: string | null;
  reportCount: number;
  reporters: string[];
  firstReportedAt: string;
  reportIds: string[];
}

export function ReportsPanel({
  isOpen,
  onClose,
  socket,
  serverHost,
  memberList,
}: {
  isOpen: boolean;
  onClose: () => void;
  socket: Socket | null;
  serverHost: string;
  memberList?: Array<{ nickname: string; serverUserId: string }>;
}) {
  const [reports, setReports] = useState<AggregatedReport[]>([]);
  const [userReports, setUserReports] = useState<AggregatedUserReport[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  /**
   * Why the queue is not here, when it is not here.
   *
   * The spinner used to be the only state between asking and answering, and it
   * was cleared in exactly one place — the reply. A server that had stopped, a
   * socket part-way through reconnecting, or a refusal arriving as
   * `server:error` all left it turning, and a moderator cannot tell that apart
   * from a queue that is still loading.
   */
  const [loadError, setLoadError] = useState<string | null>(null);

  /* The handlers below outlive the render they were attached in, so they ask a
     ref rather than a closure over `isLoading` from whenever that was. */
  const loadingRef = useRef(false);
  loadingRef.current = isLoading;
  const [confirmAction, setConfirmAction] = useState<{
    report: AggregatedReport;
    action: "delete" | "delete_all_and_ban";
  } | null>(null);
  const [confirmUserAction, setConfirmUserAction] = useState<{
    report: AggregatedUserReport;
    action: "kick" | "ban";
  } | null>(null);

  /* The buttons follow the same permissions the server checks, so a role that
     may work the queue but not ban is not shown a button that answers
     "forbidden". `manage_reports` is what got this panel open at all. */
  const { has } = useServerPermissions(serverHost || "");

  const fetchReports = useCallback(() => {
    setLoadError(null);

    /* Said rather than shown as an empty queue. There is nothing to wait for
       here — no socket, or no token — so starting a spinner would be waiting
       for a reply nobody asked for. */
    if (!socket || !socket.connected || !serverHost) {
      setIsLoading(false);
      setLoadError("Not connected to this server.");
      return;
    }
    const accessToken = getServerAccessToken(serverHost);
    if (!accessToken) {
      setIsLoading(false);
      setLoadError("Join this server again to see its reports.");
      return;
    }

    setIsLoading(true);
    socket.emit("reports:list", { accessToken });
  }, [socket, serverHost]);

  useEffect(() => {
    if (!socket) return;

    const onReportsList = (payload: {
      reports: AggregatedReport[];
      userReports?: AggregatedUserReport[];
    }) => {
      setReports(payload.reports || []);
      /* Absent on a server that predates user reports, which is not the same
         as an empty queue — but it renders the same, and the section is left
         out either way. */
      setUserReports(payload.userReports || []);
      setIsLoading(false);
      setLoadError(null);
    };

    /*
     * A refusal, or the socket going away, ends the wait.
     *
     * `server:error` is the server's one error channel, so this only listens
     * while something is actually being waited for — otherwise an unrelated
     * failure elsewhere in the app would put a message in this panel.
     */
    const onServerError = (payload?: { message?: string }) => {
      if (!loadingRef.current) return;
      setIsLoading(false);
      setLoadError(payload?.message || "Couldn't load the reports.");
    };

    const onDisconnect = () => {
      if (!loadingRef.current) return;
      setIsLoading(false);
      setLoadError("Lost the connection to this server.");
    };

    const onResolved = (payload: { messageId: string; action: string; deletedCount?: number }) => {
      if (payload.action === "delete_all_and_ban") {
        setReports((prev) => {
          const target = prev.find((r) => r.messageId === payload.messageId);
          if (!target) return prev.filter((r) => r.messageId !== payload.messageId);
          return prev.filter(
            (r) => r.senderServerUserId !== target.senderServerUserId,
          );
        });
        toast.success(`User banned & ${payload.deletedCount ?? 0} messages deleted`);
      } else {
        setReports((prev) => prev.filter((r) => r.messageId !== payload.messageId));
        if (payload.action === "approve") {
          toast.success("Report dismissed");
        } else if (payload.action === "delete") {
          toast.success("Message deleted");
        }
      }
      setConfirmAction(null);
    };

    const onUserResolved = (payload: {
      reportedServerUserId: string;
      action: "dismiss" | "kick" | "ban";
    }) => {
      setUserReports((prev) =>
        prev.filter((r) => r.reportedServerUserId !== payload.reportedServerUserId),
      );
      if (payload.action === "dismiss") toast.success("Report dismissed");
      else if (payload.action === "kick") toast.success("User kicked");
      else toast.success("User banned");
      setConfirmUserAction(null);
    };

    socket.on("reports:list", onReportsList);
    socket.on("reports:resolved", onResolved);
    socket.on("reports:user_resolved", onUserResolved);
    socket.on("server:error", onServerError);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("reports:list", onReportsList);
      socket.off("reports:resolved", onResolved);
      socket.off("reports:user_resolved", onUserResolved);
      socket.off("server:error", onServerError);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    if (isOpen) fetchReports();
  }, [isOpen, fetchReports]);

  const handleApprove = useCallback(
    (report: AggregatedReport) => {
      if (!socket || !serverHost) return;
      const accessToken = getServerAccessToken(serverHost);
      if (!accessToken) return;
      socket.emit("reports:resolve", {
        accessToken,
        messageId: report.messageId,
        conversationId: report.conversationId,
        action: "approve",
      });
    },
    [socket, serverHost],
  );

  const handleDelete = useCallback(
    (report: AggregatedReport) => {
      if (!socket || !serverHost) return;
      const accessToken = getServerAccessToken(serverHost);
      if (!accessToken) return;
      socket.emit("reports:resolve", {
        accessToken,
        messageId: report.messageId,
        conversationId: report.conversationId,
        action: "delete",
      });
    },
    [socket, serverHost],
  );

  const handleDeleteAllAndBan = useCallback(
    (report: AggregatedReport) => {
      if (!socket || !serverHost) return;
      const accessToken = getServerAccessToken(serverHost);
      if (!accessToken) return;
      socket.emit("reports:resolve", {
        accessToken,
        messageId: report.messageId,
        conversationId: report.conversationId,
        action: "delete_all_and_ban",
        senderServerUserId: report.senderServerUserId,
      });
    },
    [socket, serverHost],
  );

  const resolveUser = useCallback(
    (report: AggregatedUserReport, action: "dismiss" | "kick" | "ban") => {
      if (!socket || !serverHost) return;
      const accessToken = getServerAccessToken(serverHost);
      if (!accessToken) return;
      socket.emit("reports:resolve_user", {
        accessToken,
        reportedServerUserId: report.reportedServerUserId,
        action,
      });
    },
    [socket, serverHost],
  );

  const getNickname = (serverUserId: string): string => {
    const member = memberList?.find((m) => m.serverUserId === serverUserId);
    return member?.nickname || serverUserId.slice(0, 8) + "...";
  };

  return (
    <>
      <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup style={{ maxWidth: 700, maxHeight: "80vh" }}>
          <Dialog.Title>
            <div className="flex items-center gap-2">
              <PiWarningFill size={16} />
              Reports
              {reports.length + userReports.length > 0 && (
                <Chip tone="danger">
                  {reports.length + userReports.length}
                </Chip>
              )}
            </div>
          </Dialog.Title>
          <Dialog.Description>
            Reported messages, and people reported for something with no single
            message behind it.
          </Dialog.Description>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size={24} />
            </div>
          ) : loadError ? (
            /* Not the empty state. An empty queue is good news and this is
               not news at all — it is the panel admitting it does not know,
               which is the one thing the spinner could never say. */
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <PiWarningCircle size={32} style={{ color: "var(--gryt-warning-9)" }} />
              <span className="text-base text-gryt-muted">{loadError}</span>
              <Button tone="neutral" size="small" onClick={fetchReports}>
                Try again
              </Button>
            </div>
          ) : reports.length === 0 && userReports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <PiCheck size={32} style={{ color: "var(--gryt-success-9)" }} />
              <span className="text-base text-gryt-muted">
                No pending reports
              </span>
            </div>
          ) : (
            <ScrollArea.Root className="max-h-[55vh]">
              <ScrollArea.Viewport className="max-h-[55vh]">
               <ScrollArea.Content>
              <div className="flex flex-col gap-3">
                {/* People first. A report about a person is the one with a
                    reader waiting on it — there is no message sitting in a
                    channel doing the work of being the evidence. */}
                {userReports.length > 0 && (
                  <>
                    <span className="text-xs font-bold text-gryt-muted">
                      People — {userReports.length}
                    </span>
                    {userReports.map((report) => (
                      <UserReportCard
                        key={report.reportedServerUserId}
                        report={report}
                        getNickname={getNickname}
                        canKick={has("kick_members")}
                        canBan={has("ban_members")}
                        onDismiss={() => resolveUser(report, "dismiss")}
                        onKick={() => setConfirmUserAction({ report, action: "kick" })}
                        onBan={() => setConfirmUserAction({ report, action: "ban" })}
                      />
                    ))}
                  </>
                )}

                {reports.length > 0 && (
                  <span
                    className="text-xs font-bold text-gryt-muted"
                    style={{ marginTop: userReports.length > 0 ? 8 : undefined }}
                  >
                    Messages — {reports.length}
                  </span>
                )}
                {reports.map((report) => (
                  <ReportCard
                    key={report.messageId}
                    report={report}
                    getNickname={getNickname}
                    serverHost={serverHost}
                    onApprove={() => handleApprove(report)}
                    onDelete={() => setConfirmAction({ report, action: "delete" })}
                    onDeleteAllAndBan={() =>
                      setConfirmAction({ report, action: "delete_all_and_ban" })
                    }
                  />
                ))}
              </div>
              </ScrollArea.Content>
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar orientation="vertical" />
            </ScrollArea.Root>
          )}

          <div className="flex justify-end mt-4">
            <Dialog.Close>
              <Button tone="neutral" size="small">
                Close
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <AlertDialog.Root
        open={!!confirmAction}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop />
          <AlertDialog.Popup>
          <AlertDialog.Title>
            {confirmAction?.action === "delete_all_and_ban"
              ? "Delete all messages & ban user?"
              : "Delete this message?"}
          </AlertDialog.Title>
          <AlertDialog.Description>
            {confirmAction?.action === "delete_all_and_ban" ? (
              <>
                This will permanently delete <strong>all messages</strong> from{" "}
                <strong>{confirmAction.report.senderNickname || "this user"}</strong> across
                every channel and ban them from the server. This cannot be undone.
              </>
            ) : (
              "This will permanently delete this reported message. This cannot be undone."
            )}
          </AlertDialog.Description>
          <div className="flex gap-3 mt-4 justify-end">
            <AlertDialog.Close
              render={
                <Button tone="neutral" size="small">
                  Cancel
                </Button>
              }
            />
            <AlertDialog.Close
              render={
                <Button tone="danger" size="small"
                  onClick={() => {
                    if (!confirmAction) return;
                    if (confirmAction.action === "delete_all_and_ban") {
                      handleDeleteAllAndBan(confirmAction.report);
                    } else {
                      handleDelete(confirmAction.report);
                    }
                  }}
                >
                  {confirmAction?.action === "delete_all_and_ban"
                    ? "Delete All & Ban"
                    : "Delete Message"}
                </Button>
              }
            />
          </div>
        </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={!!confirmUserAction}
        onOpenChange={(open) => !open && setConfirmUserAction(null)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop />
          <AlertDialog.Popup>
            <AlertDialog.Title>
              {confirmUserAction?.action === "ban" ? "Ban" : "Kick"}{" "}
              {confirmUserAction?.report.reportedNickname ||
                (confirmUserAction ? getNickname(confirmUserAction.report.reportedServerUserId) : "")}
              ?
            </AlertDialog.Title>
            <AlertDialog.Description>
              {confirmUserAction?.action === "ban"
                ? "They are removed and cannot rejoin. Their messages stay where they are — delete those from the message queue or their profile if they should go too."
                : "They are removed now and can rejoin. Their messages stay where they are."}{" "}
              Every open report about them is closed either way.
            </AlertDialog.Description>
            <div className="flex gap-3 mt-4 justify-end">
              <AlertDialog.Close render={<Button tone="neutral" size="small">Cancel</Button>} />
              <AlertDialog.Close
                render={
                  <Button
                    tone="danger"
                    size="small"
                    onClick={() => {
                      if (!confirmUserAction) return;
                      resolveUser(confirmUserAction.report, confirmUserAction.action);
                    }}
                  >
                    {confirmUserAction?.action === "ban" ? "Ban" : "Kick"}
                  </Button>
                }
              />
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function UserReportCard({
  report,
  getNickname,
  canKick,
  canBan,
  onDismiss,
  onKick,
  onBan,
}: {
  report: AggregatedUserReport;
  getNickname: (id: string) => string;
  canKick: boolean;
  canBan: boolean;
  onDismiss: () => void;
  onKick: () => void;
  onBan: () => void;
}) {
  const name = report.reportedNickname || getNickname(report.reportedServerUserId);

  return (
    <div style={{
        border: "1px solid var(--gryt-neutral-6)",
        borderRadius: "var(--gryt-radius-lg)",
        padding: "14px",
        background: "var(--gryt-neutral-2)",
      }}>
      <div className="flex gap-3 items-start">
        <div className="flex flex-col gap-2" style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold" style={{ color: "var(--gryt-neutral-12)" }}>
              {name}
            </span>
            <Chip tone="danger">
              {report.reportCount} {report.reportCount === 1 ? "report" : "reports"}
            </Chip>
          </div>

          {/* Every reason, each with the person who wrote it. Two people
              describing the same evening differently is the thing a moderator
              most needs to see, so they are not merged or truncated. */}
          <div className="flex flex-col gap-2">
            {report.reasons.map((entry, idx) => (
              <div
                key={`${entry.reporterServerUserId}-${idx}`}
                style={{
                  background: "var(--gryt-neutral-3)",
                  borderRadius: "var(--gryt-radius-md)",
                  padding: "10px 12px",
                  borderLeft: "3px solid var(--gryt-danger-8)",
                }}
              >
                <span className="text-sm" style={{
                    color: "var(--gryt-neutral-11)",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}>
                  {entry.reason}
                </span>
                {/* The snapshot first. `getNickname` reads the live member
                    list, which no longer holds somebody who has left — and the
                    reporter leaving is the ordinary case here. */}
                <div className="text-xs text-gryt-muted" style={{ marginTop: 6 }}>
                  {entry.reporterNickname || getNickname(entry.reporterServerUserId)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 items-center" style={{ flexShrink: 0 }}>
          {/* Named as well as tooltipped. A tooltip is not an accessible name,
              and three unlabelled icons on a moderation card are three
              identical buttons to a screen reader. */}
          <Tooltip title="Dismiss (nothing to do here)">
            <IconButton
              tone="neutral"
              size="medium"
              aria-label={`Dismiss the reports about ${name}`}
              onClick={onDismiss}
              style={{ cursor: "pointer" }}
            >
              <PiCheck size={18} />
            </IconButton>
          </Tooltip>

          {canKick && (
            <Tooltip title="Kick them from the server">
              <IconButton
                tone="danger"
                size="medium"
                aria-label={`Kick ${name} from the server`}
                onClick={onKick}
                style={{ cursor: "pointer" }}
              >
                <PiBootFill size={18} />
              </IconButton>
            </Tooltip>
          )}

          {canBan && (
            <Tooltip title="Ban them from the server">
              <IconButton
                tone="danger"
                size="medium"
                aria-label={`Ban ${name} from the server`}
                onClick={onBan}
                style={{ cursor: "pointer" }}
              >
                <PiProhibitFill size={18} />
              </IconButton>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportCard({
  report,
  getNickname,
  serverHost,
  onApprove,
  onDelete,
  onDeleteAllAndBan,
}: {
  report: AggregatedReport;
  getNickname: (id: string) => string;
  serverHost: string;
  onApprove: () => void;
  onDelete: () => void;
  onDeleteAllAndBan: () => void;
}) {
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

  return (
    <>
      <div style={{
          border: "1px solid var(--gryt-neutral-6)",
          borderRadius: "var(--gryt-radius-lg)",
          padding: "14px",
          background: "var(--gryt-neutral-2)",
        }}>
        <div className="flex gap-3 items-start">
          <div className="flex flex-col gap-2" style={{ flex: 1, minWidth: 0 }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold" style={{ color: "var(--gryt-neutral-12)" }}>
                {report.senderNickname || getNickname(report.senderServerUserId)}
              </span>
              <Chip tone="danger">
                {report.reportCount} {report.reportCount === 1 ? "report" : "reports"}
              </Chip>
            </div>

            <div style={{
                background: "var(--gryt-neutral-3)",
                borderRadius: "var(--gryt-radius-md)",
                padding: "10px 12px",
                borderLeft: "3px solid var(--gryt-danger-8)",
              }}>
              {report.messageText && (
                <span className="text-sm" style={{
                    color: "var(--gryt-neutral-11)",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}>
                  {report.messageText}
                </span>
              )}

              {report.attachments && report.attachments.length > 0 && serverHost && (
                <div className="flex gap-2 flex-wrap flex-col" style={{ marginTop: report.messageText ? "8px" : undefined }}>
                  {report.attachments.map((fileId, idx) => {
                    const meta = report.enrichedAttachments?.[idx];
                    const url = getUploadsFileUrl(serverHost, fileId);
                    const mime = meta?.mime || "";

                    if (mime.startsWith("image/")) {
                      return (
                        <img
                          key={fileId}
                          src={url}
                          alt={meta?.original_name || "Attachment"}
                          style={{
                            maxWidth: "100%",
                            maxHeight: 200,
                            borderRadius: "var(--gryt-radius-md)",
                            cursor: "pointer",
                            objectFit: "contain",
                          }}
                          onClick={() => setLightboxImage({ src: url, alt: meta?.original_name || "Attachment" })}
                        />
                      );
                    }

                    if (mime.startsWith("video/")) {
                      const thumbUrl = meta?.has_thumbnail ? getUploadsFileUrl(serverHost, fileId, { thumb: true }) : undefined;
                      return (
                        <video
                          key={fileId}
                          src={url}
                          poster={thumbUrl}
                          controls
                          style={{ maxWidth: "100%", maxHeight: 200, borderRadius: "var(--gryt-radius-md)" }}
                        />
                      );
                    }

                    return (
                      <FileCard
                        key={fileId}
                        fileId={fileId}
                        mime={meta?.mime ?? null}
                        size={meta?.size ?? null}
                        originalName={meta?.original_name ?? null}
                        serverHost={serverHost}
                      />
                    );
                  })}
                </div>
              )}

              {!report.messageText && (!report.attachments || report.attachments.length === 0) && (
                <span className="text-sm text-gryt-muted" style={{ fontStyle: "italic" }}>
                  (empty message)
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-xs text-gryt-muted">
                Reported by:{" "}
                {report.reporters.map((r) => getNickname(r)).join(", ")}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 items-center" style={{ flexShrink: 0 }}>
            <Tooltip title="Dismiss (message is fine)">
              <IconButton tone="neutral" size="medium"
                onClick={onApprove}
                style={{ cursor: "pointer" }}
              >
                <PiCheck size={18} />
              </IconButton>
            </Tooltip>

            <Tooltip title="Delete this message">
              <IconButton tone="danger" size="medium"
                onClick={onDelete}
                style={{ cursor: "pointer" }}
              >
                <PiTrashFill size={18} />
              </IconButton>
            </Tooltip>

            <Tooltip title="Delete all messages from user & ban">
              <IconButton tone="danger" size="medium"
                onClick={onDeleteAllAndBan}
                style={{ cursor: "pointer" }}
              >
                <PiProhibitFill size={18} />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      </div>
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </>
  );
}
