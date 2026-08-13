import { AlertDialog, Button, Chip, Dialog, IconButton, ScrollArea, Spinner, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { PiCheck, PiProhibitFill, PiTrashFill, PiWarningFill } from "react-icons/pi";
import type { Socket } from "socket.io-client";

import { getServerAccessToken, getUploadsFileUrl } from "@/common";

import type { AttachmentMeta } from "./chatUtils";
import { FileCard } from "./FileCard";
import { ImageLightbox } from "./ImageLightbox";

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
  const [isLoading, setIsLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    report: AggregatedReport;
    action: "delete" | "delete_all_and_ban";
  } | null>(null);

  const fetchReports = useCallback(() => {
    if (!socket || !serverHost) return;
    const accessToken = getServerAccessToken(serverHost);
    if (!accessToken) return;
    setIsLoading(true);
    socket.emit("reports:list", { accessToken });
  }, [socket, serverHost]);

  useEffect(() => {
    if (!socket) return;

    const onReportsList = (payload: { reports: AggregatedReport[] }) => {
      setReports(payload.reports || []);
      setIsLoading(false);
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

    socket.on("reports:list", onReportsList);
    socket.on("reports:resolved", onResolved);

    return () => {
      socket.off("reports:list", onReportsList);
      socket.off("reports:resolved", onResolved);
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
              Reported Messages
              {reports.length > 0 && (
                <Chip tone="danger">
                  {reports.length}
                </Chip>
              )}
            </div>
          </Dialog.Title>
          <Dialog.Description>
            Review reported messages. Approve to dismiss or delete to remove the message.
          </Dialog.Description>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size={24} />
            </div>
          ) : reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <PiCheck size={32} style={{ color: "var(--green-9)" }} />
              <span className="text-base text-gryt-muted">
                No pending reports
              </span>
            </div>
          ) : (
            <ScrollArea.Root className="max-h-[55vh]">
              <ScrollArea.Viewport className="max-h-[55vh]">
               <ScrollArea.Content>
              <div className="flex flex-col gap-3">
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
          <AlertDialog.Popup className="max-w-112">
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
            <AlertDialog.Close render={<span />}>
              <Button tone="neutral" size="small">
                Cancel
              </Button>
            </AlertDialog.Close>
            <AlertDialog.Close render={<span />}>
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
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
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
          border: "1px solid var(--gray-6)",
          borderRadius: "var(--radius-5)",
          padding: "14px",
          background: "var(--gray-2)",
        }}>
        <div className="flex gap-3 items-start">
          <div className="flex flex-col gap-2" style={{ flex: 1, minWidth: 0 }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold" style={{ color: "var(--gray-12)" }}>
                {report.senderNickname || getNickname(report.senderServerUserId)}
              </span>
              <Chip tone="danger">
                {report.reportCount} {report.reportCount === 1 ? "report" : "reports"}
              </Chip>
            </div>

            <div style={{
                background: "var(--gray-3)",
                borderRadius: "var(--radius-4)",
                padding: "10px 12px",
                borderLeft: "3px solid var(--red-8)",
              }}>
              {report.messageText && (
                <span className="text-sm" style={{
                    color: "var(--gray-11)",
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
                            borderRadius: "var(--radius-3)",
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
                          style={{ maxWidth: "100%", maxHeight: 200, borderRadius: "var(--radius-3)" }}
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
