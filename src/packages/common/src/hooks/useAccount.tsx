import { useEffect, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import type { Account } from "@/common";
import { signOut } from "@/common";
import { clearUserCache } from "@/settings/src/hooks/userStorage";

import { getElectronAPI, isElectron } from "../../../../lib/electron";
import {
  cancelPendingLogin,
  handleAuthCallback,
  LOGIN_CANCELLED,
} from "../auth/electron-auth";
import {
  doLogout,
  fetchRegistrationAllowed,
  initKeycloak,
  startLogin,
  startRegister,
} from "../auth/keycloak";

function useAccountHook(): Account {
  const [isSignedIn, setIsSignedIn] = useState<boolean | undefined>(undefined);
  const [loginInProgress, setLoginInProgress] = useState(false);
  const [registrationAllowed, setRegistrationAllowed] = useState(false);

  // Wire up the Electron deep-link listener
  useEffect(() => {
    if (!isElectron()) return;

    const api = getElectronAPI();
    if (!api) return;

    const unsubscribe = api.onAuthCallback(async (url) => {
      try {
        await handleAuthCallback(url);
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
          setLoginInProgress(true);
          startLogin().then(() => initKeycloak()).then(({ keycloak: kc, authenticated: auth }) => {
            const result = !!(auth && kc.token);
            console.log("[Auth:Hook] Electron login flow result — signedIn:", result);
            if (!cancelled) setIsSignedIn(result);
          }).catch((e) => {
            console.error("[Auth:Hook] Electron login flow failed:", e);
          }).finally(() => {
            if (!cancelled) setLoginInProgress(false);
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

  function cancelLogin() {
    cancelPendingLogin();
    setLoginInProgress(false);
  }

  async function login() {
    setLoginInProgress(true);
    try {
      await startLogin(window.location.href);
      if (isElectron()) {
        const { keycloak, authenticated } = await initKeycloak();
        setIsSignedIn(!!(authenticated && keycloak.token));
      }
    } catch (err) {
      if (err instanceof Error && err.message === LOGIN_CANCELLED) return;
      console.error("Login failed:", err);
    }
    setLoginInProgress(false);
  }

  async function register() {
    setLoginInProgress(true);
    try {
      await startRegister(window.location.href);
      if (isElectron()) {
        const { keycloak, authenticated } = await initKeycloak();
        setIsSignedIn(!!(authenticated && keycloak.token));
      }
    } catch (err) {
      if (err instanceof Error && err.message === LOGIN_CANCELLED) return;
      console.error("Register failed:", err);
    }
    setLoginInProgress(false);
  }

  async function logout() {
    console.log("[Auth:Hook] logout() called", new Error().stack);
    signOut();
    clearUserCache();
    setIsSignedIn(false);
    try {
      await doLogout();
    } catch {
      // ignore
    }
  }

  return {
    isSignedIn,
    loginInProgress,
    registrationAllowed,
    login,
    register,
    logout,
    cancelLogin,
  };
}

const init: Account = {
  isSignedIn: undefined,
  loginInProgress: false,
  registrationAllowed: false,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  cancelLogin: () => {},
};

export const useAccount = singletonHook(init, useAccountHook);
