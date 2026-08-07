import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Link,
  Switch,
  Text,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { MdFolder } from "react-icons/md";

import type { AddonManifest } from "@/addons";
import { useAddons } from "@/addons";

import { getElectronAPI, isElectron } from "../../../../lib/electron";
import { SettingsContainer } from "./settingsComponents";

function useAddonAssetUrl(
  addonId: string,
  relativePath?: string
): string | null {
  const [url, setUrl] = useState<string | null>(
    relativePath ? `/addons/${addonId}/${relativePath}` : null
  );

  useEffect(() => {
    let cancelled = false;

    if (!relativePath) {
      setUrl(null);
      return;
    }

    if (!isElectron()) {
      setUrl(`/addons/${addonId}/${relativePath}`);
      return;
    }

    const api = getElectronAPI();
    if (!api) {
      setUrl(null);
      return;
    }

    api
      .resolveAddonAsset(addonId, relativePath)
      .then((resolved) => {
        if (!cancelled) {
          setUrl(resolved);
        }
      })
      .catch((err) => {
        console.error(
          `[AddonsSettings] Failed to resolve asset ${addonId}/${relativePath}:`,
          err
        );
        if (!cancelled) {
          setUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [addonId, relativePath]);

  return url;
}

function AddonCard({
  addon,
  enabled,
  onToggle,
}: {
  addon: AddonManifest;
  enabled: boolean;
  onToggle: () => void;
}) {
  const isTheme = addon.type === "theme";
  const bannerUrl = useAddonAssetUrl(addon.id, addon.banner);

  return (
    <Box
      style={{
        borderRadius: "var(--radius-4)",
        border: "1px solid var(--gray-5)",
        overflow: "hidden",
        background: "var(--color-panel-solid)",
      }}
    >
      <Box
        style={{
          height: 120,
          background: bannerUrl
            ? undefined
            : isTheme
            ? "linear-gradient(135deg, var(--purple-9), var(--plum-9))"
            : "linear-gradient(135deg, var(--blue-9), var(--cyan-9))",
          backgroundImage: bannerUrl ? `url(${bannerUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />

      <Flex direction="column" gap="2" p="3">
        <Flex justify="between" align="start">
          <Flex direction="column" gap="1" style={{ minWidth: 0, flex: 1 }}>
            <Flex align="center" gap="2" wrap="wrap">
              <Badge
                size="1"
                color={isTheme ? "purple" : "blue"}
                variant="soft"
              >
                {isTheme ? "Theme" : "Plugin"}
              </Badge>
              <Text size="1" color="gray">
                v{addon.version}
              </Text>
              {!isTheme && addon.requiresReloadOnDisable && (
                <Badge size="1" color="orange" variant="soft">
                  Reload on disable
                </Badge>
              )}
            </Flex>
            <Text weight="bold" size="3" truncate>
              {addon.name}
            </Text>
          </Flex>
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            style={{ flexShrink: 0 }}
          />
        </Flex>

        {addon.description && (
          <Text
            size="2"
            color="gray"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {addon.description}
          </Text>
        )}

        {addon.author && (
          <Text size="1" color="gray">
            by {addon.author}
          </Text>
        )}
      </Flex>
    </Box>
  );
}

export function AddonsSettings() {
  const { addons, enabledIds, toggleAddon, openAddonsFolder } = useAddons();
  const inElectron = isElectron();

  return (
    <SettingsContainer>
      <Flex justify="between" align="center">
        <Heading size="4">Addons</Heading>
        {inElectron && (
          <Button
            variant="soft"
            color="gray"
            size="2"
            onClick={openAddonsFolder}
          >
            <MdFolder size={16} />
            Open Addons Folder
          </Button>
        )}
      </Flex>

      {addons.length === 0 ? (
        <Flex
          direction="column"
          align="center"
          gap="2"
          py="8"
          style={{ color: "var(--gray-9)" }}
        >
          <Text size="2" color="gray">
            No addons yet
          </Text>
          {/*
            Every other empty state in the app offers somewhere to go. This one
            described a file format and stopped, which reads as an error to
            anyone who has not written an addon before.
          */}
          <Text size="1" color="gray" align="center" style={{ maxWidth: 380 }}>
            {inElectron
              ? "Addons are folders in your addons directory, each with an addon.json manifest."
              : "Addons load from a mounted addons directory. The desktop app can open that folder for you."}
          </Text>
          <Link
            href="https://docs.gryt.chat/docs"
            target="_blank"
            rel="noreferrer"
            size="1"
          >
            Read the addon docs
          </Link>
        </Flex>
      ) : (
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "var(--space-3)",
          }}
        >
          {addons.map((addon) => (
            <AddonCard
              key={addon.id}
              addon={addon}
              enabled={enabledIds.has(addon.id)}
              onToggle={() => toggleAddon(addon.id)}
            />
          ))}
        </Box>
      )}
    </SettingsContainer>
  );
}
