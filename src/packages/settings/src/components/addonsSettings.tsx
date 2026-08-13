import { Button, Chip, Switch } from "@gryt/ui";
import { useEffect, useState } from "react";
import { PiFolderFill } from "react-icons/pi";

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
    <div style={{
        borderRadius: "var(--radius-4)",
        border: "1px solid var(--gray-5)",
        overflow: "hidden",
        background: "var(--color-panel-solid)",
      }}>
      <div style={{
          height: 120,
          background: bannerUrl
            ? undefined
            : isTheme
            ? "linear-gradient(135deg, var(--purple-9), var(--plum-9))"
            : "linear-gradient(135deg, var(--blue-9), var(--cyan-9))",
          backgroundImage: bannerUrl ? `url(${bannerUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }} />

      <div className="flex flex-col gap-2 p-3">
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-1" style={{ minWidth: 0, flex: 1 }}>
            <div className="flex items-center gap-2 flex-wrap">
              <Chip tone="neutral"
                color={isTheme ? "purple" : "blue"}
              >
                {isTheme ? "Theme" : "Plugin"}
              </Chip>
              <span className="text-xs text-gryt-muted">
                v{addon.version}
              </span>
              {!isTheme && addon.requiresReloadOnDisable && (
                <Chip tone="warning" label="Reload on disable" />
              )}
            </div>
            <span className="font-bold text-base truncate">
              {addon.name}
            </span>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            style={{ flexShrink: 0 }}
          />
        </div>

        {addon.description && (
          <span className="text-sm text-gryt-muted" style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}>
            {addon.description}
          </span>
        )}

        {addon.author && (
          <span className="text-xs text-gryt-muted">
            by {addon.author}
          </span>
        )}
      </div>
    </div>
  );
}

export function AddonsSettings() {
  const { addons, enabledIds, toggleAddon, openAddonsFolder } = useAddons();
  const inElectron = isElectron();

  return (
    <SettingsContainer>
      <div className="flex justify-between items-center">
        <h2 className="text-lg">Addons</h2>
        {inElectron && (
          <Button tone="neutral" size="small"
            onClick={openAddonsFolder}
          >
            <PiFolderFill size={16} />
            Open Addons Folder
          </Button>
        )}
      </div>

      {addons.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12" style={{ color: "var(--gray-9)" }}>
          <span className="text-sm text-gryt-muted">
            No addons yet
          </span>
          {/*
            Every other empty state in the app offers somewhere to go. This one
            described a file format and stopped, which reads as an error to
            anyone who has not written an addon before.
          */}
          <span className="text-xs text-gryt-muted text-center" style={{ maxWidth: 380 }}>
            {inElectron
              ? "Addons are folders in your addons directory, each with an addon.json manifest."
              : "Addons load from a mounted addons directory. The desktop app can open that folder for you."}
          </span>
          <a className="text-gryt-accent underline-offset-2 hover:underline"
            href="https://docs.gryt.chat/docs"
            target="_blank"
            rel="noreferrer"
          >
            Read the addon docs
          </a>
        </div>
      ) : (
        <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "var(--space-3)",
          }}>
          {addons.map((addon) => (
            <AddonCard
              key={addon.id}
              addon={addon}
              enabled={enabledIds.has(addon.id)}
              onToggle={() => toggleAddon(addon.id)}
            />
          ))}
        </div>
      )}
    </SettingsContainer>
  );
}
