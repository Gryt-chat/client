import { useEffect, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import type { Account } from "@/common";
import { signOut } from "@/common";

import { getElectronAPI, isElectron } from "../../../../lib/electron";
import { handleAuthCallback } from "../auth/electron-auth";
import {
  doLogout,
  fetchRegistrationAllowed,
  initKeycloak,
  resetKeycloakInit,
  startLogin,
  startRegister,
} from "../auth/keycloak";

function useAccountHook(): Account {
  const [isSignedIn, setIsSignedIn] = useState<boolean | undefined>(undefined);
  const [registrationAllowed, setRegistrationAllowed] = useState(false);

  // Wire up the Electron deep-link listener
  useEffect(() => {
    if (!isElectron()) return;

    const api = getElectronAPI();
    if (!api) return;

    const unsubscribe = api.onAuthCallback(async (url) => {
      try {
        await handleAuthCallback(url);
        // Re-init keycloak with the fresh tokens
        resetKeycloakInit();
        const { authenticated } = await initKeycloak();
        setIsSignedIn(authenticated);
      } catch (err) {
        console.error("Auth callback failed:", err);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let settled = false;

    const INIT_TIMEOUT_MS = 12_000;
    console.log("[Auth:Hook] Init effect running, timeout:", INIT_TIMEOUT_MS, "ms");
    const timeout = setTimeout(() => {
      if (!cancelled && !settled) {
        console.error("[Auth:Hook] ⚠ Init timed out after", INIT_TIMEOUT_MS, "ms — forcing unauthenticated");
        settled = true;
        setIsSignedIn(false);
      }
    }, INIT_TIMEOUT_MS);

    fetchRegistrationAllowed()
      .then((allowed) => {
        if (!cancelled) setRegistrationAllowed(allowed);
      })
      .catch(() => {});

    (async () => {
      try {
        const { keycloak, authenticated } = await initKeycloak();
        if (cancelled) {
          console.log("[Auth:Hook] Init completed but effect was cancelled");
          return;
        }

        clearTimeout(timeout);
        settled = true;

        const signedIn = !!(authenticated && keycloak.token);
        console.log("[Auth:Hook] Init result — authenticated:", authenticated,
          "hasToken:", !!keycloak.token, "→ signedIn:", signedIn);
        setIsSignedIn(signedIn);

        if (!signedIn && isElectron()) {
          console.log("[Auth:Hook] Not signed in on Electron — opening login flow");
          startLogin().then(() => initKeycloak()).then(({ keycloak: kc, authenticated: auth }) => {
            const result = !!(auth && kc.token);
            console.log("[Auth:Hook] Electron login flow result — signedIn:", result);
            if (!cancelled) setIsSignedIn(result);
          }).catch((e) => {
            console.error("[Auth:Hook] Electron login flow failed:", e);
          });
        }
      } catch (e) {
        console.error("[Auth:Hook] Keycloak init failed:", e);
        if (!settled) {
          clearTimeout(timeout);
          settled = true;
          setIsSignedIn(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  async function login() {
    try {
      await startLogin(window.location.href);
      // For Electron, startLogin resolves after the deep-link callback,
      // so we can update state here. For browser, the page redirects.
      if (isElectron()) {
        const { keycloak, authenticated } = await initKeycloak();
        setIsSignedIn(!!(authenticated && keycloak.token));
      }
    } catch (err) {
      console.error("Login failed:", err);
    }
  }

  async function register() {
    try {
      await startRegister(window.location.href);
      if (isElectron()) {
        const { keycloak, authenticated } = await initKeycloak();
        setIsSignedIn(!!(authenticated && keycloak.token));
      }
    } catch (err) {
      console.error("Register failed:", err);
    }
  }

  async function logout() {
    console.log("[Auth:Hook] logout() called", new Error().stack);
    signOut();
    setIsSignedIn(false);
    try {
      await doLogout();
    } catch {
      // ignore
    }
  }

  return {
    isSignedIn,
    registrationAllowed,
    login,
    register,
    logout,
  };
}

const init: Account = {
  isSignedIn: undefined,
  registrationAllowed: false,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
};

export const useAccount = singletonHook(init, useAccountHook);
