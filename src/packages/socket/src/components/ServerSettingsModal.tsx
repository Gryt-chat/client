import { Chip, Dialog, IconButton, Spinner, Tabs } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import { PiArrowsLeftRightFill, PiGearFill, PiHandWavingFill, PiLinkFill, PiListChecksFill, PiProhibitFill, PiSmileyFill, PiUsersFill, PiWebhooksLogoFill, PiX } from "react-icons/pi";

import { getServerAccessToken } from "@/common";

import { useSockets } from "../hooks/useSockets";
import { useVersionStatus } from "../hooks/useVersionStatus";
import { ServerAuditTab } from "./ServerAuditTab";
import { ServerBansTab } from "./ServerBansTab";
import { ServerEmojisTab } from "./ServerEmojisTab";
import { ServerInvitesTab } from "./ServerInvitesTab";
import { ServerJoinRequestsTab } from "./ServerJoinRequestsTab";
import { type ServerOverviewInitialSettings,ServerOverviewTab } from "./ServerOverviewTab";
import { ServerRolesTab } from "./ServerRolesTab";
import { ServerUserReplaceTab } from "./ServerUserReplaceTab";
import { ServerWebhooksTab } from "./ServerWebhooksTab";

type SetupRequiredDetail = {
  host: string;
  serverId?: string;
  settings?: {
    displayName?: string;
    description?: string;
    iconUrl?: string | null;
    isConfigured?: boolean;
  };
};

type SettingsOpenDetail = { host: string };

export function ServerSettingsModal() {
  const { sockets, serverDetailsList, tokenRevision } = useSockets();

  const [isOpen, setIsOpen] = useState(false);
  const [host, setHost] = useState<string>("");
  const [tab, setTab] = useState<string>("overview");
  const [initialOverviewSettings, setInitialOverviewSettings] = useState<ServerOverviewInitialSettings | undefined>(undefined);

  const socket = useMemo(() => (host ? sockets[host] : undefined), [sockets, host]);
  const accessToken = useMemo(() => {
    void tokenRevision;
    return host ? getServerAccessToken(host) : null;
  }, [host, tokenRevision]);

  const serverInfo = host ? serverDetailsList[host]?.server_info : undefined;
  const role = serverInfo?.role;
  const canManage = role === "owner" || role === "admin";
  const permissionKnown = role === "owner" || role === "admin" || role === "mod" || role === "member";
  const allowTabs = canManage || !permissionKnown;

  function handleDialogChange(open: boolean) {
    setIsOpen(open);
    if (!open) {
      setHost("");
      setTab("overview");
      setInitialOverviewSettings(undefined);
    }
  }

  useEffect(() => {
    const handler = (event: CustomEvent<SettingsOpenDetail>) => {
      const h = event.detail?.host;
      if (!h) return;
      setHost(h);
      setInitialOverviewSettings(undefined);
      setTab("overview");
      setIsOpen(true);
    };
    window.addEventListener("server_settings_open", handler as EventListener);
    return () => window.removeEventListener("server_settings_open", handler as EventListener);
  }, []);

  useEffect(() => {
    const handler = (event: CustomEvent<SetupRequiredDetail>) => {
      const h = event.detail?.host;
      if (!h) return;
      setHost(h);
      setInitialOverviewSettings({
        displayName: event.detail?.settings?.displayName,
        description: event.detail?.settings?.description,
      });
      setTab("overview");
      setIsOpen(true);
    };
    window.addEventListener("server_setup_required", handler as EventListener);
    return () => window.removeEventListener("server_setup_required", handler as EventListener);
  }, []);

  const isOwner = role === "owner";

  const { status: versionStatus, loading: versionLoading } = useVersionStatus(
    socket,
    host,
    accessToken,
    isOpen && canManage,
  );

  const TAB_CONFIG = [
    {
      value: "overview",
      label: "Overview",
      icon: PiGearFill,
      content: (
        <ServerOverviewTab
          host={host}
          socket={socket}
          accessToken={accessToken}
          initialSettings={initialOverviewSettings}
          channels={host ? serverDetailsList[host]?.channels ?? [] : []}
        />
      ),
    },
    {
      value: "invites",
      label: "Invites",
      icon: PiLinkFill,
      content: <ServerInvitesTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "requests",
      label: "Requests",
      icon: PiHandWavingFill,
      content: <ServerJoinRequestsTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "roles",
      label: "Roles",
      icon: PiUsersFill,
      content: <ServerRolesTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "emojis",
      label: "Emojis",
      icon: PiSmileyFill,
      content: <ServerEmojisTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "bans",
      label: "Bans",
      icon: PiProhibitFill,
      content: (
        <ServerBansTab
          host={host}
          socket={socket}
          accessToken={accessToken}
          onUnban={(grytUserId) => socket?.emit("server:unban", { accessToken, grytUserId })}
        />
      ),
    },
    {
      value: "audit",
      label: "Audit Log",
      icon: PiListChecksFill,
      content: <ServerAuditTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "webhooks",
      label: "Webhooks",
      icon: PiWebhooksLogoFill,
      content: <ServerWebhooksTab host={host} channels={host ? serverDetailsList[host]?.channels ?? [] : []} />,
    },
    ...(isOwner
      ? [
          {
            value: "replace-user" as const,
            label: "Replace User",
            icon: PiArrowsLeftRightFill,
            content: <ServerUserReplaceTab host={host} socket={socket} accessToken={accessToken} />,
          },
        ]
      : []),
  ];

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleDialogChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        {/* Sized rather than bounded. max-width with no width leaves the
            dialog to its content, and a 200px rail beside a column of fields
            settles near the 600px minimum — narrow enough that a one-line
            description wrapped and the textarea was a slot. Both dimensions
            give way to the viewport before they clip. */}
        <Dialog.Popup
          className="max-w-none"
          style={{
            width: "min(1040px, calc(100vw - 4rem))",
            height: "min(700px, calc(100vh - 4rem))",
          }}
        >
        <Dialog.Close
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
          }}
        >
          <IconButton tone="neutral" size="xsmall">
            <PiX size={16} />
          </IconButton>
        </Dialog.Close>

        <div className="flex flex-col gap-4 h-full">
          <Dialog.Title>
            Server settings
          </Dialog.Title>

          {isOpen && (
            allowTabs ? (
              <Tabs
                value={tab}
                onValueChange={(v) => setTab(String(v))}
                orientation="vertical"
                style={{ flex: 1, minHeight: 0 }}
              >
                <div className="flex gap-4 h-full">
                  <div style={{ minWidth: "200px", flexShrink: 0, overflowY: "auto" }}>
                    <Tabs.List aria-label="Server settings" className="gap-1">
                      {TAB_CONFIG.map(({ value, label, icon: Icon }) => (
                        <Tabs.Tab key={value} value={value}>
                          <Icon size={16} />
                          {label}
                        </Tabs.Tab>
                      ))}
                      <Tabs.Indicator />
                    </Tabs.List>
                    <div className="flex flex-col gap-1" style={{ padding: "12px 16px", fontFamily: "var(--code-font-family)" }}>
                      {serverInfo?.version && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gryt-muted" style={{ opacity: 0.5 }}>
                            Server v{serverInfo.version}
                          </span>
                          {versionLoading && <Spinner size={16} />}
                          {versionStatus?.server.updateAvailable && (
                            <Chip tone="warning">
                              v{versionStatus.server.latest}
                            </Chip>
                          )}
                        </div>
                      )}
                      {versionStatus?.sfu && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gryt-muted" style={{ opacity: 0.5 }}>
                            SFU {versionStatus.sfu.current ? `v${versionStatus.sfu.current}` : "—"}
                          </span>
                          {versionStatus.sfu.updateAvailable && (
                            <Chip tone="warning">
                              v{versionStatus.sfu.latest}
                            </Chip>
                          )}
                        </div>
                      )}
                      {/* Absent, not dashed, when there is no worker to ask.
                          A server without one is a normal deployment, and a
                          permanent "—" would read as something being broken. */}
                      {versionStatus?.worker && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gryt-muted" style={{ opacity: 0.5 }}>
                            Image worker{" "}
                            {versionStatus.worker.current
                              ? `v${versionStatus.worker.current}`
                              : "—"}
                          </span>
                          {versionStatus.worker.updateAvailable && (
                            <Chip tone="warning">
                              v{versionStatus.worker.latest}
                            </Chip>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
                    {!permissionKnown ? (
                      <span className="text-sm text-gryt-muted" style={{ marginBottom: 12 }}>
                        Loading permissions…
                      </span>
                    ) : null}
                    {TAB_CONFIG.map(({ value, content }) => (
                      <Tabs.Panel key={value} value={value}>
                        {content}
                      </Tabs.Panel>
                    ))}
                  </div>
                </div>
              </Tabs>
            ) : (
              <div className="flex flex-col gap-3">
                <span className="text-sm text-gryt-muted">
                  Server settings are only available to server admins.
                </span>
              </div>
            )
          )}
        </div>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

