import { Box, Dialog, Flex, IconButton, Tabs, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { FiX } from "react-icons/fi";
import { MdFactCheck, MdGroup, MdLink, MdSettings } from "react-icons/md";

import { getServerAccessToken } from "@/common";

import { useSockets } from "../hooks/useSockets";
import { ServerAuditTab } from "./ServerAuditTab";
import { ServerInvitesTab } from "./ServerInvitesTab";
import { type ServerOverviewInitialSettings,ServerOverviewTab } from "./ServerOverviewTab";
import { ServerRolesTab } from "./ServerRolesTab";

type SetupRequiredDetail = {
  host: string;
  serverId?: string;
  settings?: {
    displayName?: string;
    description?: string;
    iconUrl?: string | null;
    hasPassword?: boolean;
    isConfigured?: boolean;
  };
};

type SettingsOpenDetail = { host: string };

export function ServerSettingsModal() {
  const { sockets, serverDetailsList } = useSockets();

  const [isOpen, setIsOpen] = useState(false);
  const [host, setHost] = useState<string>("");
  const [tab, setTab] = useState<string>("overview");
  const [initialOverviewSettings, setInitialOverviewSettings] = useState<ServerOverviewInitialSettings | undefined>(undefined);

  const socket = useMemo(() => (host ? sockets[host] : undefined), [sockets, host]);
  const accessToken = useMemo(() => (host ? getServerAccessToken(host) : null), [host]);

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
        hasPassword: event.detail?.settings?.hasPassword,
      });
      setTab("overview");
      setIsOpen(true);
    };
    window.addEventListener("server_setup_required", handler as EventListener);
    return () => window.removeEventListener("server_setup_required", handler as EventListener);
  }, []);

  const TAB_CONFIG = [
    {
      value: "overview",
      label: "Overview",
      icon: MdSettings,
      content: (
        <ServerOverviewTab
          host={host}
          socket={socket}
          accessToken={accessToken}
          initialSettings={initialOverviewSettings}
        />
      ),
    },
    {
      value: "invites",
      label: "Invites",
      icon: MdLink,
      content: <ServerInvitesTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "roles",
      label: "Roles",
      icon: MdGroup,
      content: <ServerRolesTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "audit",
      label: "Audit Log",
      icon: MdFactCheck,
      content: <ServerAuditTab host={host} socket={socket} accessToken={accessToken} />,
    },
  ] as const;

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleDialogChange}>
      <Dialog.Content maxWidth="900px" style={{ height: "700px", minWidth: "600px" }}>
        <Dialog.Close
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
          }}
        >
          <IconButton variant="soft" color="gray">
            <FiX size={16} />
          </IconButton>
        </Dialog.Close>

        <Flex direction="column" gap="4" height="100%">
          <Dialog.Title as="h1" weight="bold" size="6">
            Server settings
          </Dialog.Title>

          {isOpen && (
            allowTabs ? (
              <Tabs.Root
                value={tab}
                onValueChange={setTab}
                orientation="vertical"
                style={{ flex: 1, minHeight: 0 }}
              >
                <Flex gap="4" height="100%">
                  <Box style={{ minWidth: "200px", flexShrink: 0, overflowY: "auto" }}>
                    <Tabs.List
                      style={{
                        flexDirection: "column",
                        alignItems: "stretch",
                        height: "fit-content",
                        gap: "4px",
                      }}
                    >
                      {TAB_CONFIG.map(({ value, label, icon: Icon }) => (
                        <Tabs.Trigger
                          key={value}
                          value={value}
                          style={{
                            justifyContent: "flex-start",
                            padding: "12px 16px",
                            gap: "8px",
                          }}
                        >
                          <Icon size={16} />
                          {label}
                        </Tabs.Trigger>
                      ))}
                    </Tabs.List>
                    {serverInfo?.version && (
                      <Text
                        size="1"
                        color="gray"
                        style={{ fontFamily: "var(--code-font-family)", padding: "12px 16px", opacity: 0.5 }}
                      >
                        Server v{serverInfo.version}
                      </Text>
                    )}
                  </Box>

                  <Box style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
                    {!permissionKnown ? (
                      <Text size="2" color="gray" style={{ marginBottom: 12 }}>
                        Loading permissions…
                      </Text>
                    ) : null}
                    {TAB_CONFIG.map(({ value, content }) => (
                      <Tabs.Content key={value} value={value}>
                        {content}
                      </Tabs.Content>
                    ))}
                  </Box>
                </Flex>
              </Tabs.Root>
            ) : (
              <Flex direction="column" gap="3">
                <Text size="2" color="gray">
                  Server settings are only available to server admins.
                </Text>
              </Flex>
            )
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

