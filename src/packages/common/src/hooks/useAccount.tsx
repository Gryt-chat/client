import { useEffect, useState } from "react";

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
import { singletonHook } from "./singletonHook";

/**
 * Remembered so the choice survives a reload. Without it, "continue without an
 * account" would put you in front of the sign-in screen again on every start,
 * which reads as the choice not having been taken seriously.
 */
const LOCAL_IDENTITY_KEY = "gryt_use_local_identity";

function readLocalIdentityChoice(): boolean {
  try {
    return localStorage.getItem(LOCAL_IDENTITY_KEY) === "true";
  } catch {
    return false;
  }
}

function writeLocalIdentityChoice(value: boolean): void {
  try {
    if (value) localStorage.setItem(LOCAL_IDENTITY_KEY, "true");
    else localStorage.removeItem(LOCAL_IDENTITY_KEY);
  } catch {
    // localStorage not available
  }
}

function useAccountHook(): Account {
  const [isSignedIn, setIsSignedIn] = useState<boolean | undefined>(undefined);
  const [usingLocalIdentity, setUsingLocalIdentity] = useState(
    () => readLocalIdentityChoice(),
  );
  const [loginInProgress, setLoginInProgress] = useState(false);
  const [registrationAllowed, setRegistrationAllowed] = useState(false);

  useEffect(() => {
    if (isSignedIn == null) return;
    const api = getElectronAPI();
    api?.setSignedIn(isSignedIn);
  }, [isSignedIn]);

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

  /**
   * Use Gryt without signing in. Servers that accept a local identity will let
   * you in on the strength of a key generated per server; ones that want a Gryt
   * account will say so when you try to join.
   */
  function continueWithoutAccount() {
    writeLocalIdentityChoice(true);
    setUsingLocalIdentity(true);
  }

  async function logout() {
    console.log("[Auth:Hook] logout() called", new Error().stack);
    signOut();
    clearUserCache();
    setIsSignedIn(false);
    // Back to the entry screen rather than silently continuing as a local
    // identity, which would look like the logout had not worked.
    writeLocalIdentityChoice(false);
    setUsingLocalIdentity(false);
    try {
      await doLogout();
    } catch {
      // ignore
    }
  }

  return {
    isSignedIn,
    usingLocalIdentity,
    continueWithoutAccount,
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
  usingLocalIdentity: false,
  loginInProgress: false,
  registrationAllowed: false,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  cancelLogin: () => {},
  continueWithoutAccount: () => {},
};

export const useAccount = singletonHook(init, useAccountHook);
