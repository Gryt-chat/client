import { Button, Chip, Switch } from "@gryt/ui";
import { useEffect, useState } from "react";
import { PiFolderFill } from "react-icons/pi";

import type { AddonManifest, AddonUpdate } from "@/addons";
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

/**
 * What each addon's repository says is newer, keyed by addon id.
 *
 * Checked when this screen opens rather than on a timer. Nobody needs to learn
 * an addon is out of date mid-call, and a check that only runs while somebody
 * is looking at the answer cannot quietly spend their rate limit.
 */
function useAddonUpdates(): Record<string, AddonUpdate> {
  const [updates, setUpdates] = useState<Record<string, AddonUpdate>>({});

  useEffect(() => {
    if (!isElectron()) return;

    const api = getElectronAPI();
    // Absent on a build older than this feature, and the page still works.
    if (!api?.checkAddonUpdates) return;

    let cancelled = false;

    api
      .checkAddonUpdates()
      .then((found) => {
        if (cancelled) return;
        setUpdates(
          Object.fromEntries(found.map((update) => [update.addonId, update])),
        );
      })
      .catch(() => {
        // Offline, or GitHub is having a day. The page is still the page.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return updates;
}

function AddonCard({
  addon,
  enabled,
  onToggle,
  update,
}: {
  addon: AddonManifest;
  enabled: boolean;
  onToggle: () => void;
  update?: AddonUpdate;
}) {
  const isTheme = addon.type === "theme";
  const bannerUrl = useAddonAssetUrl(addon.id, addon.banner);

  return (
    <div style={{
        borderRadius: "var(--gryt-radius-md)",
        border: "1px solid var(--gryt-neutral-5)",
        overflow: "hidden",
        background: "var(--gryt-neutral-2)",
      }}>
      <div style={{
          height: 120,
          background: bannerUrl
            ? undefined
            : isTheme
            ? "linear-gradient(135deg, var(--gryt-accent-9), var(--gryt-accent-9))"
            : "linear-gradient(135deg, var(--gryt-secondary-9), var(--gryt-secondary-9))",
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
              {update && (
                <Chip tone="neutral" color="green">
                  v{update.latest} available
                </Chip>
              )}
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

        {/* Opens the release rather than installing it. Replacing an addon's
            files means running whatever the repository publishes next, so the
            step where somebody looks at it first is the point, not a gap. */}
        {update && (
          <Button tone="neutral" size="small"
            onClick={() => getElectronAPI()?.openExternal(update.releaseUrl)}
          >
            View v{update.latest}
          </Button>
        )}
      </div>
    </div>
  );
}

export function AddonsSettings() {
  const { addons, enabledIds, toggleAddon, openAddonsFolder } = useAddons();
  const updates = useAddonUpdates();
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
        <div className="flex flex-col items-center gap-2 py-12" style={{ color: "var(--gryt-neutral-9)" }}>
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
            gap: "12px",
          }}>
          {addons.map((addon) => (
            <AddonCard
              key={addon.id}
              addon={addon}
              enabled={enabledIds.has(addon.id)}
              onToggle={() => toggleAddon(addon.id)}
              update={updates[addon.id]}
            />
          ))}
        </div>
      )}
    </SettingsContainer>
  );
}
