import { Button, Chip, TextField } from "@gryt/ui";
import {
  Flex,
  Text,
} from "@radix-ui/themes";
import { type ChangeEvent } from "react";
import { PiDownloadSimpleFill, PiMagnifyingGlassFill, PiX } from "react-icons/pi";

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
        <TextField
          size="small"
          placeholder="https://emoji.gg/pack/... or https://betterttv.com/users/..."
          value={url}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter") handleFetch();
          }}
          disabled={fetching || importing}
          className="flex-1"
        />
        <Button tone="neutral" size="xsmall"
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
              <Chip tone="neutral">
                {emotes.length} emote{emotes.length !== 1 && "s"}
              </Chip>
              <Chip tone="success">
                {selectedEmotes.length} selected
              </Chip>
            </Flex>
            <Flex gap="2">
              <Button tone="ghost" size="xsmall"
                onClick={() => toggleAll(true)}
                disabled={importing}
              >
                Select all
              </Button>
              <Button tone="ghost" size="xsmall"
                onClick={() => toggleAll(false)}
                disabled={importing}
              >
                Deselect all
              </Button>
            </Flex>
          </Flex>

          {emotes.length > 10 && (
            <div className="relative">
              {/* Same trick as the settings search: the library's TextField is
                  a field rather than a container, so the icon sits over it. */}
              <PiMagnifyingGlassFill
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gryt-muted"
                size={14}
              />
              <TextField
                className="pl-8"
                size="small"
                placeholder="Filter emotes..."
                value={filterText}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setFilterText(e.target.value)
                }
              />
            </div>
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
            <Button tone="neutral" size="xsmall"
              disabled={importing}
              onClick={handleClear}
            >
              <PiX size={14} /> Clear
            </Button>
            <Button size="xsmall"
              disabled={importing || validSelectedCount === 0}
              onClick={handleImport}
            >
              <PiDownloadSimpleFill size={14} />
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
