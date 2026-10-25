import { Button } from "@gryt/ui";

import { useAccount } from "@/common";

import { useApproveDevice } from "../../../../lib/pairing/useApproveDevice";
import { MessageKeySection } from "./messageKeySection";
import { OwnDevicesSection } from "./ownDevicesSection";
import { SettingGroup, SettingsContainer } from "./settingsComponents";

/** Your devices, on a page of their own rather than inside Security, and how to add one. */
export function YourDevicesSettings() {
  const { open: openApproveDevice } = useApproveDevice();
  const { isSignedIn } = useAccount();

  return (
    <SettingsContainer>
      <h2 className="text-lg">Your devices</h2>

      <SettingGroup
        title="Add a device"
        description="Set up a phone, tablet or computer with your key and your servers. The new device shows a code; scan it with this device, or type it here."
      >
        <Button size="small" style={{ alignSelf: "flex-start" }} onClick={openApproveDevice}>
          Link a device
        </Button>
      </SettingGroup>

      <OwnDevicesSection />

      {isSignedIn && <MessageKeySection />}
    </SettingsContainer>
  );
}
