import { useEffect, useState } from "react";

import type { Account } from "@/common";
import { clearClaimDecisions, signOut } from "@/common";
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
 * Left behind by the version of Gryt that asked people to choose between an
 * account and a guest identity on first run. Nothing reads it now — being a
 * guest is simply what you are until you sign in — so it is cleared once to
 * keep it from sitting in storage looking meaningful.
 */
const STALE_LOCAL_IDENTITY_KEY = "gryt_use_local_identity";

function clearStaleIdentityChoice(): void {
  try {
    localStorage.removeItem(STALE_LOCAL_IDENTITY_KEY);
  } catch {
    // localStorage not available
  }
}

function useAccountHook(): Account {
  const [isSignedIn, setIsSignedIn] = useState<boolean | undefined>(undefined);
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
    clearStaleIdentityChoice();
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

  async function logout() {
    console.log("[Auth:Hook] logout() called", new Error().stack);
    signOut();
    clearUserCache();
    // The next account gets asked for itself rather than inheriting a yes that
    // was meant for this one.
    clearClaimDecisions();
    // Signing out drops back to being a guest rather than to a sign-in wall.
    // Local identities are untouched, so the servers joined without an account
    // are still there — signing out of an account is not a request to forget
    // everything else.
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
