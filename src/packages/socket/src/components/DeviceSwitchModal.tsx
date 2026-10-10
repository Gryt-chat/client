import { Button, Dialog, IconButton } from "@gryt/ui";
import { useEffect,useState } from "react";

import { useTranslation } from "@/i18n";

import { PiWarningFill, PiX } from "../../../../lib/icons";

interface DeviceSwitchData {
  message: string;
  newDevice?: {
    clientId: string;
    nickname: string;
  };
}

export function DeviceSwitchModal() {
  const { t: tr } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [deviceSwitchData, setDeviceSwitchData] = useState<DeviceSwitchData | null>(null);

  useEffect(() => {
    const handleDeviceSwitch = (event: CustomEvent) => {
      setDeviceSwitchData(event.detail);
      setIsOpen(true);
    };

    window.addEventListener('voice:device:disconnect', handleDeviceSwitch as EventListener);

    return () => {
      window.removeEventListener('voice:device:disconnect', handleDeviceSwitch as EventListener);
    };
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    setDeviceSwitchData(null);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[28.125rem]">
        <div className="flex flex-col gap-4 items-center p-4">
          <div className="flex items-center gap-3 mb-2">
            <PiWarningFill 
              size={24} 
              color="orange" 
            />
            <span className="text-lg font-bold text-gryt-warning">
              {tr("ui.deviceSwitchDetected")}
            </span>
          </div>
          
          <span className="text-base text-center text-gryt-muted">
            {tr("ui.youVeBeenDisconnectedBecauseYouJoinedFrom")}
          </span>
          
          {deviceSwitchData?.newDevice && (
            <div className="flex flex-col gap-2 p-3" style={{ 
                backgroundColor: "var(--gryt-neutral-3)", 
                borderRadius: "var(--gryt-radius-md)",
                width: "100%"
              }}>
              <span className="text-sm font-medium text-gryt-muted">
                {tr("ui.newConnectionFrom")}
              </span>
              <span className="text-base font-medium">
                {deviceSwitchData.newDevice.nickname}
              </span>
            </div>
          )}
          
          <span className="text-sm text-center text-gryt-muted mt-2">
            {tr("ui.onlyOneDeviceCanBeConnectedToVoice")}
          </span>
          
          <Button size="small" 
            onClick={handleClose}
            style={{ marginTop: "8px" }}
          >
            {tr("ui.gotIt")}
          </Button>
        </div>
        
        <Dialog.Close>
          <IconButton tone="ghost" size="xsmall"
            style={{ position: "absolute", top: "12px", right: "12px" }}
            onClick={handleClose}
          >
            <PiX size={16} />
          </IconButton>
        </Dialog.Close>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
