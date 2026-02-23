import { AlertDialog, Badge, Box, Button, Dialog, Flex, IconButton, ScrollArea, Spinner, Text, Tooltip } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MdBlock, MdCheck, MdDelete, MdWarning } from "react-icons/md";
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
        <Dialog.Content
          style={{ maxWidth: 700, maxHeight: "80vh" }}
        >
          <Dialog.Title>
            <Flex align="center" gap="2">
              <MdWarning size={16} />
              Reported Messages
              {reports.length > 0 && (
                <Badge color="red" variant="solid" size="1">
                  {reports.length}
                </Badge>
              )}
            </Flex>
          </Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="4">
            Review reported messages. Approve to dismiss or delete to remove the message.
          </Dialog.Description>

          {isLoading ? (
            <Flex align="center" justify="center" py="8">
              <Spinner size="3" />
            </Flex>
          ) : reports.length === 0 ? (
            <Flex direction="column" align="center" justify="center" py="8" gap="2">
              <MdCheck size={32} style={{ color: "var(--green-9)" }} />
              <Text size="3" color="gray">
                No pending reports
              </Text>
            </Flex>
          ) : (
            <ScrollArea style={{ maxHeight: "55vh" }}>
              <Flex direction="column" gap="3">
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
              </Flex>
            </ScrollArea>
          )}

          <Flex justify="end" mt="4">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                Close
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <AlertDialog.Root
        open={!!confirmAction}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialog.Content maxWidth="450px">
          <AlertDialog.Title>
            {confirmAction?.action === "delete_all_and_ban"
              ? "Delete all messages & ban user?"
              : "Delete this message?"}
          </AlertDialog.Title>
          <AlertDialog.Description size="2">
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
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="solid"
                color="red"
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
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
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
      <Box
        style={{
          border: "1px solid var(--gray-6)",
          borderRadius: "var(--radius-5)",
          padding: "14px",
          background: "var(--gray-2)",
        }}
      >
        <Flex gap="3" align="start">
          <Flex direction="column" gap="2" style={{ flex: 1, minWidth: 0 }}>
            <Flex align="center" gap="2" wrap="wrap">
              <Text size="2" weight="bold" style={{ color: "var(--gray-12)" }}>
                {report.senderNickname || getNickname(report.senderServerUserId)}
              </Text>
              <Badge color="red" variant="soft" size="1">
                {report.reportCount} {report.reportCount === 1 ? "report" : "reports"}
              </Badge>
            </Flex>

            <Box
              style={{
                background: "var(--gray-3)",
                borderRadius: "var(--radius-4)",
                padding: "10px 12px",
                borderLeft: "3px solid var(--red-8)",
              }}
            >
              {report.messageText && (
                <Text
                  size="2"
                  style={{
                    color: "var(--gray-11)",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {report.messageText}
                </Text>
              )}

              {report.attachments && report.attachments.length > 0 && serverHost && (
                <Flex gap="2" wrap="wrap" direction="column" style={{ marginTop: report.messageText ? "8px" : undefined }}>
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
                </Flex>
              )}

              {!report.messageText && (!report.attachments || report.attachments.length === 0) && (
                <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
                  (empty message)
                </Text>
              )}
            </Box>

            <Flex align="center" gap="1">
              <Text size="1" color="gray">
                Reported by:{" "}
                {report.reporters.map((r) => getNickname(r)).join(", ")}
              </Text>
            </Flex>
          </Flex>

          <Flex direction="column" gap="2" align="center" style={{ flexShrink: 0 }}>
            <Tooltip content="Dismiss (message is fine)">
              <IconButton
                variant="soft"
                color="green"
                size="3"
                radius="full"
                onClick={onApprove}
                style={{ cursor: "pointer" }}
              >
                <MdCheck size={18} />
              </IconButton>
            </Tooltip>

            <Tooltip content="Delete this message">
              <IconButton
                variant="soft"
                color="red"
                size="3"
                radius="full"
                onClick={onDelete}
                style={{ cursor: "pointer" }}
              >
                <MdDelete size={18} />
              </IconButton>
            </Tooltip>

            <Tooltip content="Delete all messages from user & ban">
              <IconButton
                variant="solid"
                color="red"
                size="3"
                radius="full"
                onClick={onDeleteAllAndBan}
                style={{ cursor: "pointer" }}
              >
                <MdBlock size={18} />
              </IconButton>
            </Tooltip>
          </Flex>
        </Flex>
      </Box>
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
