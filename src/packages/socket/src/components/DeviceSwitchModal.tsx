import { Button, Dialog, IconButton } from "@gryt/ui";
import { Flex, Text } from "@radix-ui/themes";
import { useEffect,useState } from "react";
import { PiWarningFill, PiX } from "react-icons/pi";

interface DeviceSwitchData {
  message: string;
  newDevice?: {
    clientId: string;
    nickname: string;
  };
}

export function DeviceSwitchModal() {
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
        <Dialog.Popup style={{ maxWidth: 450 }}>
        <Flex direction="column" gap="4" align="center" p="4">
          <Flex align="center" gap="3" mb="2">
            <PiWarningFill 
              size={24} 
              color="orange" 
            />
            <Text size="4" weight="bold" color="orange">
              Device Switch Detected
            </Text>
          </Flex>
          
          <Text size="3" align="center" color="gray">
            You've been disconnected because you joined from another device.
          </Text>
          
          {deviceSwitchData?.newDevice && (
            <Flex 
              direction="column" 
              gap="2" 
              p="3" 
              style={{ 
                backgroundColor: "var(--gray-3)", 
                borderRadius: "var(--radius-4)",
                width: "100%"
              }}
            >
              <Text size="2" weight="medium" color="gray">
                New connection from:
              </Text>
              <Text size="3" weight="medium">
                {deviceSwitchData.newDevice.nickname}
              </Text>
            </Flex>
          )}
          
          <Text size="2" align="center" color="gray" mt="2">
            Only one device can be connected to voice at a time. You can rejoin from any device.
          </Text>
          
          <Button size="small" 
            onClick={handleClose}
            style={{ marginTop: "8px" }}
          >
            Got it
          </Button>
        </Flex>
        
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
