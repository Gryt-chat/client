import { Button } from "@gryt/ui";

import { useAccount } from "@/common";
import { useHostsAwaitingApproval } from "@/socket";

import { useApproveDevice } from "../../../../lib/pairing/useApproveDevice";
import { useLinkDevice } from "../../../../lib/pairing/useLinkDevice";
import { MessageKeySection } from "./messageKeySection";
import { OwnDevicesSection } from "./ownDevicesSection";
import { SettingGroup, SettingsContainer } from "./settingsComponents";

/** Your devices, on a page of their own rather than inside Security, and how to add one. */
export function YourDevicesSettings() {
  const { open: openApproveDevice } = useApproveDevice();
  const { open: openLinkDevice } = useLinkDevice();
  const needsKey = useHostsAwaitingApproval().size > 0;
  const { isSignedIn } = useAccount();

  return (
    <SettingsContainer>
      <h2 className="text-lg">Your devices</h2>

      {needsKey ? (
        <SettingGroup
          title="Link this device"
          description="This device doesn't have your message key yet. Show a code here and scan it with your phone, or type it on a device you already use."
        >
          <div className="flex flex-wrap gap-2">
            <Button size="small" onClick={openLinkDevice}>Link this device</Button>
            <Button size="small" tone="ghost" onClick={openApproveDevice}>Add another device instead</Button>
          </div>
        </SettingGroup>
      ) : (
        <SettingGroup
          title="Link a device"
          description="Set up a phone, tablet or computer with your key and your servers. The new device shows a code: scan it with your phone, or type it here."
        >
          <div className="flex flex-wrap gap-2">
            <Button size="small" onClick={openApproveDevice}>Link a device</Button>
            <Button size="small" tone="ghost" onClick={openLinkDevice}>This is the new device</Button>
          </div>
        </SettingGroup>
      )}

      <OwnDevicesSection />

      {isSignedIn && <MessageKeySection />}
    </SettingsContainer>
  );
}
