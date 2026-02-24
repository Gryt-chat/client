import { Badge, Box, Dialog, Flex, IconButton, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { MdClose } from "react-icons/md";

import { getFreshServerAccessToken, type TokenRefreshSocketLike } from "../utils/tokenManager";

type EmojiJobStatus = "queued" | "processing" | "done" | "error" | "superseded";

interface EmojiJobListItem {
  job_id: string;
  name: string;
  status: EmojiJobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface EmojiQueueState {
  pendingCount: number;
  jobs: EmojiJobListItem[];
}

function statusColor(status: EmojiJobStatus): "gray" | "amber" | "green" | "red" {
  if (status === "queued") return "gray";
  if (status === "processing") return "amber";
  if (status === "done" || status === "superseded") return "green";
  return "red";
}

function hasOnOff(
  socket: TokenRefreshSocketLike,
): socket is TokenRefreshSocketLike & {
  on: (event: "server:emojiQueue:state", handler: (payload: EmojiQueueState) => void) => void;
  off: (event: "server:emojiQueue:state", handler: (payload: EmojiQueueState) => void) => void;
} {
  const maybe = socket as { on?: unknown; off?: unknown };
  return typeof maybe.on === "function" && typeof maybe.off === "function";
}

export function EmojiQueueModal({
  host,
  socket,
  open,
  onOpenChange,
}: {
  host: string;
  socket: TokenRefreshSocketLike | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<EmojiJobListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!socket || socket.connected === false) return;
    if (!hasOnOff(socket)) return;

    setLoading(true);
    setError(null);
    (async () => {
      const token = await getFreshServerAccessToken(host, socket);
      if (!token) {
        setLoading(false);
        setError("Not authenticated.");
        return;
      }
      socket.emit("server:emojiQueue:get", { accessToken: token });
    })().catch((e: unknown) => {
      setLoading(false);
      setError(e instanceof Error ? e.message : "Failed to load emoji queue.");
    });
  }, [host, open, socket]);

  useEffect(() => {
    if (!open) return;
    if (!socket || socket.connected === false) return;
    if (!hasOnOff(socket)) return;

    const handler = (payload: EmojiQueueState) => {
      setJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
      setLoading(false);
    };
    socket.on("server:emojiQueue:state", handler);
    return () => {
      socket.off("server:emojiQueue:state", handler);
    };
  }, [open, socket]);

  const pendingCount = useMemo(
    () => jobs.filter((j) => j.status === "queued" || j.status === "processing").length,
    [jobs],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 720 }}>
        <Flex justify="between" align="center" gap="3" mb="3">
          <Dialog.Title>Emoji queue</Dialog.Title>
          <Dialog.Close>
            <IconButton variant="ghost" color="gray">
              <MdClose size={18} />
            </IconButton>
          </Dialog.Close>
        </Flex>

        <Text size="2" color="gray">
          Uploads are queued server-side so you can close settings.{" "}
          {pendingCount > 0 ? `${pendingCount} pending.` : "No pending jobs."}
        </Text>

        {error && (
          <Box mt="3">
            <Text size="2" color="red">{error}</Text>
          </Box>
        )}

        <Box mt="3" style={{ maxHeight: 420, overflowY: "auto" }}>
          {loading && jobs.length === 0 ? (
            <Text size="2" color="gray">Loading…</Text>
          ) : jobs.length === 0 ? (
            <Text size="2" color="gray">No jobs.</Text>
          ) : (
            <Flex direction="column" gap="2">
              {jobs.map((j) => (
                <Flex
                  key={j.job_id}
                  justify="between"
                  align="center"
                  gap="2"
                  p="2"
                  style={{
                    border: "1px solid var(--gray-a4)",
                    borderRadius: "var(--radius-2)",
                  }}
                >
                  <Flex direction="column" gap="1" style={{ minWidth: 0, flex: 1 }}>
                    <Text size="2" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      :{j.name}:
                    </Text>
                    {j.status === "error" && j.error_message && (
                      <Text size="1" color="red" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {j.error_message}
                      </Text>
                    )}
                  </Flex>
                  <Badge size="1" variant="soft" color={statusColor(j.status)}>
                    {j.status}
                  </Badge>
                </Flex>
              ))}
            </Flex>
          )}
        </Box>
      </Dialog.Content>
    </Dialog.Root>
  );
}

