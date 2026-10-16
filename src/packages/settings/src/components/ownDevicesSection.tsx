import type { MlsOwnDevice } from "@gryt/core";
import { Alert, Avatar, Button, Chip, IconButton, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import toast from "react-hot-toast";

import { GeneratedServerIcon, serverIconSrc, useAccount } from "@/common";
import {
  groupLinkedDeviceNotices,
  isUnusedOwnDevice,
  type LinkedDeviceGroup,
  linkedDeviceLine,
  linkedDeviceNotices,
  orderOwnDevices,
  ownDeviceAdded,
  ownDeviceLabel,
  ownDeviceLastUsed,
  type OwnDevicesAnswer,
  ownMlsDevices,
  removedHereLine,
  removeOwnDeviceWarning,
  removeOwnMlsDevice,
  useMlsSource,
  useServerManagement,
  useSockets,
} from "@/socket";

import { isElectron } from "../../../../lib/electron";
import { PiDevicesFill, PiTrashSimpleFill } from "../../../../lib/icons";
import { ConfirmDialog } from "../../../socket/src/components/ConfirmDialog";
import { SettingGroup } from "./settingsComponents";

type Loaded = OwnDevicesAnswer | { kind: "loading" } | { kind: "failed" };

function DeviceRow({ device, serverName, onRemove }: { device: MlsOwnDevice; serverName: string; onRemove: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const added = [ownDeviceAdded(device), ownDeviceLastUsed(device)].filter(Boolean).join(" · ");

  return (
    <div
      className="flex items-center gap-3 py-2 px-3"
      style={{ borderRadius: "var(--gryt-radius-sm)", background: "var(--gryt-neutral-a2)" }}
    >
      <PiDevicesFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm">{ownDeviceLabel(device)}</span>
          {device.thisDevice && <Chip tone="neutral">This device</Chip>}
        </div>
        {added && <span className="text-xs text-gryt-muted">{added}</span>}
      </div>
      {!device.thisDevice && (
        <Tooltip title="Remove device">
          <IconButton tone="ghost" size="xsmall" disabled={removing} onClick={() => setConfirming(true)}>
            <PiTrashSimpleFill size={16} />
          </IconButton>
        </Tooltip>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Remove device?"
        description={removeOwnDeviceWarning(device, serverName)}
        confirmLabel="Remove"
        onConfirm={() => {
          setRemoving(true);
          void onRemove().finally(() => setRemoving(false));
        }}
      />
    </div>
  );
}

function ServerDevices({ host, name, icon }: { host: string; name: string; icon: string | undefined }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const source = useMlsSource(host);
  const { isSignedIn } = useAccount();

  const load = useCallback(() => {
    ownMlsDevices(host).then(setLoaded, (e: unknown) => {
      console.warn("[MLS] Couldn't list devices for", host, e);
      setLoaded({ kind: "failed" });
    });
  }, [host]);

  // Again when the session comes up, and after a device is added or removed anywhere.
  useEffect(() => {
    load();
    return source?.onChange((conversationId) => {
      if (conversationId === null) load();
    });
  }, [load, source]);

  const remove = async (device: MlsOwnDevice) => {
    try {
      await removeOwnMlsDevice(host, device.deviceId);
      toast.success("Device removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove the device");
    }
    load();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Avatar
          size="small"
          className="rounded-(--gryt-radius-md) p-0"
          fallback={<GeneratedServerIcon seed={name} />}
          src={icon}
        />
        <span className="truncate text-sm">{name}</span>
      </div>
      {loaded.kind === "loading" && <span className="text-xs text-gryt-muted">Loading…</span>}
      {loaded.kind === "no_mls" && <span className="text-xs text-gryt-muted">This server doesn't have encrypted DMs.</span>}
      {loaded.kind === "removed" && (
        <span className="text-xs text-gryt-muted">
          {removedHereLine(isElectron() ? "app" : "browser", isSignedIn ? "sign_in" : "recovery_key")}
        </span>
      )}
      {loaded.kind === "not_connected" && (
        <span className="text-xs text-gryt-muted">Connect to this server to see your devices there.</span>
      )}
      {loaded.kind === "failed" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gryt-muted">Couldn't load your devices here.</span>
          <Button size="xsmall" onClick={load}>
            Retry
          </Button>
        </div>
      )}
      {loaded.kind === "devices" &&
        orderOwnDevices(loaded.devices).map((device) => (
          <DeviceRow key={device.deviceId} device={device} serverName={name} onRemove={() => remove(device)} />
        ))}
    </div>
  );
}

/** Stays until dismissed or the device is removed (GRYT-1583). One row per device, however many
    servers it turned up on (GRYT-1764). */
function LinkedDeviceNoticeRow({ group, serverName }: { group: LinkedDeviceGroup; serverName: (host: string) => string }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const names = group.notices.map((n) => serverName(n.host));
  const where = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const ids = group.notices.map((n) => n.deviceId);

  const remove = async () => {
    setRemoving(true);
    try {
      for (const n of group.notices) await removeOwnMlsDevice(n.host, n.deviceId);
      linkedDeviceNotices.dismissAll(ids);
      toast.success(group.notices.length > 1 ? "Device removed from every server" : "Device removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove the device");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Alert severity="warning">
      <div className="flex flex-col gap-2">
        <span>
          {linkedDeviceLine(group, true)} It&rsquo;s on {where}.
        </span>
        <div className="flex flex-wrap gap-2">
          <Button size="xsmall" tone="danger" disabled={removing} onClick={() => setConfirming(true)}>
            Remove
          </Button>
          <Button size="xsmall" tone="neutral" onClick={() => linkedDeviceNotices.dismissAll(ids)}>
            It was me
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Remove device?"
        description={removeOwnDeviceWarning(group, where)}
        confirmLabel="Remove"
        onConfirm={() => void remove()}
      />
    </Alert>
  );
}

/** Every server's devices that haven't been used in a while, removed in one go (GRYT-1764). */
function RemoveUnusedDevices({ hosts, serverName }: { hosts: string[]; serverName: (host: string) => string }) {
  const [found, setFound] = useState<{ host: string; device: MlsOwnDevice }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const look = async () => {
    setBusy(true);
    const all: { host: string; device: MlsOwnDevice }[] = [];
    for (const host of hosts) {
      const answer = await ownMlsDevices(host).catch(() => null);
      if (answer?.kind === "devices") for (const device of answer.devices) if (isUnusedOwnDevice(device)) all.push({ host, device });
    }
    setBusy(false);
    if (all.length === 0) toast("No devices have gone unused for 30 days.");
    else setFound(all);
  };

  const remove = async () => {
    if (!found) return;
    setBusy(true);
    let failed = 0;
    for (const { host, device } of found) await removeOwnMlsDevice(host, device.deviceId).catch(() => failed++);
    setBusy(false);
    setFound(null);
    if (failed) toast.error(`Removed ${found.length - failed}, ${failed} didn't go through.`);
    else toast.success(`Removed ${found.length} unused ${found.length === 1 ? "device" : "devices"}`);
  };

  const servers = found ? [...new Set(found.map((f) => serverName(f.host)))] : [];
  return (
    <>
      <Button size="xsmall" tone="neutral" className="self-start" disabled={busy || hosts.length === 0} onClick={() => void look()}>
        {busy && !found ? "Looking…" : "Remove devices not used in 30 days"}
      </Button>
      <ConfirmDialog
        open={!!found}
        onOpenChange={(open) => { if (!open) setFound(null); }}
        title={`Remove ${found?.length ?? 0} unused ${found?.length === 1 ? "device" : "devices"}?`}
        description={`None of them has been used for 30 days, on ${servers.join(", ")}. They won't get new encrypted DMs there anymore, and if one connects again it deletes the encrypted DMs it has from there.`}
        confirmLabel="Remove"
        onConfirm={() => void remove()}
      />
    </>
  );
}

/** GRYT-1526. Your MLS devices on each server, and removing one you don't use anymore. */
export function OwnDevicesSection() {
  const { servers, orderedServerHosts } = useServerManagement();
  const { serverDetailsList } = useSockets();
  const notices = useSyncExternalStore(linkedDeviceNotices.subscribe, linkedDeviceNotices.get);

  return (
    <SettingGroup
      title="Your devices"
      description="Each app or browser you use for encrypted DMs is a device. Every server has its own list."
    >
      {groupLinkedDeviceNotices(notices).map((g) => (
        <LinkedDeviceNoticeRow key={g.key} group={g} serverName={(host) => servers[host]?.name || host} />
      ))}
      {orderedServerHosts.length > 0 && (
        <RemoveUnusedDevices hosts={orderedServerHosts} serverName={(host) => servers[host]?.name || host} />
      )}
      {orderedServerHosts.length === 0 ? (
        <span className="text-xs text-gryt-muted">No servers yet. Join one and it will show up here.</span>
      ) : (
        <div className="flex flex-col gap-4">
          {orderedServerHosts.map((host) => {
            const name = servers[host]?.name || host;
            return (
              <ServerDevices
                key={host}
                host={host}
                name={name}
                icon={serverIconSrc(host, servers[host]?.name || "", serverDetailsList)}
              />
            );
          })}
        </div>
      )}
    </SettingGroup>
  );
}
