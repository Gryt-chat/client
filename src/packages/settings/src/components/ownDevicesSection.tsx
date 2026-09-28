import type { MlsOwnDevice } from "@gryt/core";
import { Avatar, Button, Chip, IconButton, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { GeneratedServerIcon, serverIconSrc } from "@/common";
import {
  orderOwnDevices,
  ownDeviceAdded,
  ownDeviceLabel,
  type OwnDevicesAnswer,
  ownMlsDevices,
  removeOwnDeviceWarning,
  removeOwnMlsDevice,
  useMlsSource,
  useServerManagement,
  useSockets,
} from "@/socket";

import { PiDevicesFill, PiTrashFill } from "../../../../lib/icons";
import { ConfirmDialog } from "../../../socket/src/components/ConfirmDialog";
import { SettingGroup } from "./settingsComponents";

type Loaded = OwnDevicesAnswer | { kind: "loading" } | { kind: "failed" };

function DeviceRow({ device, serverName, onRemove }: { device: MlsOwnDevice; serverName: string; onRemove: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const added = ownDeviceAdded(device);

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
            <PiTrashFill size={16} />
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

/** GRYT-1526. Your MLS devices on each server, and removing one you don't use anymore. */
export function OwnDevicesSection() {
  const { servers, orderedServerHosts } = useServerManagement();
  const { serverDetailsList } = useSockets();

  return (
    <SettingGroup
      title="Your devices"
      description="Each app or browser you use for encrypted DMs is a device. Every server has its own list."
    >
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
