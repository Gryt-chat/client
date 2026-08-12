import { useEffect, useState } from "react";

import { getDeviceId } from "@/settings/src/hooks/deviceId";

import { initKeycloak } from "../auth/keycloak";
import { singletonHook } from "./singletonHook";
import { useAccount } from "./useAccount";

function useUserIdHook(): string | null {
  const { isSignedIn } = useAccount();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    // Undefined means Keycloak has not answered yet, which is not the same as
    // signed out. Handing back the device id here would load a guest's settings
    // for a frame and then throw them away when the account arrived.
    if (isSignedIn === undefined) {
      setUserId(null);
      return;
    }

    if (!isSignedIn) {
      setUserId(getDeviceId());
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { keycloak, authenticated } = await initKeycloak();
        if (cancelled) return;
        const sub = authenticated ? keycloak.tokenParsed?.sub : undefined;
        // Authenticated with no sub should not happen, and if it does the
        // device id is a better answer than null: settings keep working.
        setUserId(typeof sub === "string" ? sub : getDeviceId());
      } catch {
        setUserId(getDeviceId());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  return userId;
}

const init: string | null = null;

export const useUserId = singletonHook(init, useUserIdHook);
