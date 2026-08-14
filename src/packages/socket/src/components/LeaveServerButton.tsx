import { AlertDialog, Button } from "@gryt/ui";
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
      <Button tone="danger" onClick={() => setShowConfirm(true)}>
        {children}
      </Button>
      <AlertDialog.Root open={showConfirm} onOpenChange={(open) => { if (!open) setShowConfirm(false); }}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop />
          <AlertDialog.Popup>
          <AlertDialog.Title>Leave server?</AlertDialog.Title>
          <AlertDialog.Description>
            Are you sure you want to leave {host}? You will lose access to all channels and messages.
          </AlertDialog.Description>
          <div className="flex gap-3 mt-4 justify-end">
            <AlertDialog.Close render={<span />}>
              <Button tone="neutral">Cancel</Button>
            </AlertDialog.Close>
            <AlertDialog.Close render={<span />}>
              <Button
                tone="danger"
                onClick={() => {
                  leaveServer(host);
                  setShowConfirm(false);
                }}
              >
                Leave
              </Button>
            </AlertDialog.Close>
          </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
};
