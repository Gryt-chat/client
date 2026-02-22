import { AlertDialog, Button, Flex } from '@radix-ui/themes';
import React, { useState } from 'react';

import { useSockets } from '../hooks/useSockets';

interface LeaveServerButtonProps {
  host: string;
  children?: React.ReactNode;
}

export const LeaveServerButton: React.FC<LeaveServerButtonProps> = ({ 
  host, 
  children = "Leave Server"
}) => {
  const { leaveServer } = useSockets();
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <>
      <Button
        variant="solid"
        color="red"
        onClick={() => setShowConfirm(true)}
      >
        {children}
      </Button>
      <AlertDialog.Root open={showConfirm} onOpenChange={(open) => { if (!open) setShowConfirm(false); }}>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Leave server?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to leave {host}? You will lose access to all channels and messages.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={() => { leaveServer(host); setShowConfirm(false); }}>Leave</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
};
