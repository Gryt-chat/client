import { useEffect, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { initKeycloak } from "../auth/keycloak";

function useUserIdHook(): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { keycloak, authenticated } = await initKeycloak();
        if (cancelled) return;
        const sub = authenticated ? keycloak.tokenParsed?.sub : undefined;
        setUserId(typeof sub === "string" ? sub : null);
      } catch {
        setUserId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return userId;
}

const init: string | null = null;

export const useUserId = singletonHook(init, useUserIdHook);
