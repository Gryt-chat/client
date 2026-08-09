import {
  Badge,
  Button,
  Flex,
  Text,
  TextField,
} from "@radix-ui/themes";
import { type ChangeEvent } from "react";
import { PiDownloadSimple, PiMagnifyingGlass, PiX } from "react-icons/pi";

import { useEmoteImport } from "../hooks/useEmoteImport";
import { type TokenRefreshSocketLike } from "../utils/tokenManager";
import { EmoteRow } from "./EmoteRow";

export function EmoteImport({
  host,
  accessToken,
  socket,
  existingNames,
}: {
  host: string;
  accessToken: string | null;
  socket: TokenRefreshSocketLike | null;
  existingNames: Set<string>;
}) {
  const {
    url,
    setUrl,
    fetching,
    importing,
    username,
    emotes,
    filterText,
    setFilterText,
    selectedEmotes,
    validSelectedCount,
    filteredEmotes,
    handleFetch,
    toggleSelect,
    toggleAll,
    updateName,
    handleImport,
    handleClear,
  } = useEmoteImport({ host, accessToken, socket, existingNames });

  return (
    <Flex
      direction="column"
      gap="3"
      p="3"
      style={{
        border: "1px solid var(--gray-a5)",
        borderRadius: "var(--radius-2)",
      }}
    >
      <Text size="2" weight="medium">
        Import from a link
      </Text>
      <Text size="1" color="gray" style={{ marginTop: -6 }}>
        A BetterTTV user or emote, or an emoji.gg user, pack or emoji.
      </Text>

      <Flex gap="2" align="center">
        <TextField.Root
          size="1"
          placeholder="https://emoji.gg/pack/... or https://betterttv.com/users/..."
          value={url}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter") handleFetch();
          }}
          disabled={fetching || importing}
          style={{ flex: 1 }}
        />
        <Button
          size="1"
          variant="soft"
          disabled={fetching || importing || !url.trim()}
          onClick={handleFetch}
        >
          {fetching ? "Fetching..." : "Fetch"}
        </Button>
      </Flex>

      {emotes.length > 0 && (
        <>
          <Flex justify="between" align="center" gap="2">
            <Flex align="center" gap="2">
              {username && (
                <Text size="1" color="gray">
                  {username}
                </Text>
              )}
              <Badge size="1" variant="soft">
                {emotes.length} emote{emotes.length !== 1 && "s"}
              </Badge>
              <Badge size="1" variant="soft" color="green">
                {selectedEmotes.length} selected
              </Badge>
            </Flex>
            <Flex gap="2">
              <Button
                size="1"
                variant="ghost"
                onClick={() => toggleAll(true)}
                disabled={importing}
              >
                Select all
              </Button>
              <Button
                size="1"
                variant="ghost"
                onClick={() => toggleAll(false)}
                disabled={importing}
              >
                Deselect all
              </Button>
            </Flex>
          </Flex>

          {emotes.length > 10 && (
            <TextField.Root
              size="1"
              placeholder="Filter emotes..."
              value={filterText}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setFilterText(e.target.value)
              }
            >
              <TextField.Slot>
                <PiMagnifyingGlass size={14} />
              </TextField.Slot>
            </TextField.Root>
          )}

          <Flex
            direction="column"
            gap="1"
            style={{ maxHeight: 400, overflowY: "auto" }}
          >
            {filteredEmotes.map((e) => (
              <EmoteRow
                key={e.id}
                emote={e}
                importing={importing}
                onToggleSelect={toggleSelect}
                onUpdateName={updateName}
              />
            ))}
          </Flex>

          <Flex justify="end" gap="2">
            <Button
              variant="soft"
              color="gray"
              size="1"
              disabled={importing}
              onClick={handleClear}
            >
              <PiX size={14} /> Clear
            </Button>
            <Button
              size="1"
              disabled={importing || validSelectedCount === 0}
              onClick={handleImport}
            >
              <PiDownloadSimple size={14} />
              {importing
                ? "Importing..."
                : `Import ${validSelectedCount} emoji${validSelectedCount !== 1 ? "s" : ""}`}
            </Button>
          </Flex>
        </>
      )}
    </Flex>
  );
}
