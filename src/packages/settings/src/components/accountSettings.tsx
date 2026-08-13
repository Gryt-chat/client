import { Alert, Button, Chip, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { PiEyeFill, PiInfoFill, PiSignOutFill } from "react-icons/pi";

import {
  type AccountProfile,
  getAccountProfile,
  resetKeycloakInit,
  useAccount,
} from "@/common";

import {
  getCustomAuthIssuer,
  getCustomIdentityUrl,
  setCustomAuthIssuer,
  setCustomIdentityUrl,
} from "../../../../config";
import { useSettings } from "../hooks/useSettings";
import { SettingsContainer } from "./settingsComponents";

const DEFAULT_ISSUER = "https://auth.gryt.chat/realms/gryt";
const DEFAULT_IDENTITY = "https://id.gryt.chat";

/**
 * Something worth hiding until asked for.
 *
 * Settings gets opened while screen sharing, and an email address or an account
 * id sitting in plain view is the kind of thing somebody only notices after it
 * has been seen. Click to show, click again to put it away.
 */
function Revealable({ value }: { value: string }) {
  const [shown, setShown] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <code className="font-mono text-xs text-gryt-muted"
        onClick={() => setShown((s) => !s)}
        title={shown ? "Click to hide" : "Click to reveal"}
        style={{
          cursor: "pointer",
          userSelect: shown ? "all" : "none",
          filter: shown ? undefined : "blur(4px)",
          transition: "filter 120ms ease",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </code>
      {!shown && <PiEyeFill size={13} style={{ opacity: 0.5, flexShrink: 0 }} />}
    </div>
  );
}

function formatDate(value?: string | number): string | null {
  if (value === undefined) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AccountSettings() {
  const { isSignedIn, login, logout, loginInProgress } = useAccount();
  const { showAdvanced } = useSettings();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [issuerInput, setIssuerInput] = useState(
    () => getCustomAuthIssuer() || "",
  );
  const [identityInput, setIdentityInput] = useState(
    () => getCustomIdentityUrl() || "",
  );
  const [savedIssuer, setSavedIssuer] = useState(false);
  const [hasCustom, setHasCustom] = useState(
    () => getCustomAuthIssuer() !== null || getCustomIdentityUrl() !== null,
  );

  useEffect(() => {
    if (!isSignedIn) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    getAccountProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        // Nothing to show is better than an error about a detail panel.
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  const handleSaveIssuer = useCallback(() => {
    const issuer = issuerInput.trim().replace(/\/+$/, "");
    const identity = identityInput.trim().replace(/\/+$/, "");

    // The two go together. An issuer on its own sends a token from one Keycloak
    // to the certificate authority of another, and the rejection reads as a key
    // problem rather than a configuration one — so refuse the half-set state
    // instead of letting somebody discover it at sign-in.
    if (issuer.length > 0 && identity.length === 0) {
      toast.error(
        "Set the identity service too. Your auth server needs the one that signs for it, or signing in is rejected.",
      );
      return;
    }

    setCustomAuthIssuer(issuer.length > 0 ? issuer : null);
    setCustomIdentityUrl(identity.length > 0 ? identity : null);
    // Keycloak is configured once at init, so the change means nothing until
    // that is thrown away and redone.
    resetKeycloakInit();
    setSavedIssuer(true);
    setHasCustom(issuer.length > 0 || identity.length > 0);
    toast.success(
      issuer.length > 0
        ? "Using your own auth server. Sign in to check it works."
        : "Back to the Gryt auth server.",
    );
  }, [issuerInput, identityInput]);

  const handleClearIssuer = useCallback(() => {
    setIssuerInput("");
    setIdentityInput("");
    setCustomAuthIssuer(null);
    setCustomIdentityUrl(null);
    resetKeycloakInit();
    setSavedIssuer(false);
    setHasCustom(false);
    toast.success("Back to the Gryt auth server.");
  }, []);

  const isCustom =
    issuerInput.trim().length > 0 && issuerInput.trim() !== DEFAULT_ISSUER;

  return (
    <SettingsContainer>
      <h2 className="text-lg">
        Account
      </h2>

      {isSignedIn ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">
              Signed in
            </span>
            <Chip tone="success" label="Gryt account" />
          </div>

          <dl className="m-0 flex flex-col gap-3">
            {profile?.email && (
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-gryt-muted">Email</dt>
                <dd className="m-0 text-sm text-gryt-text">
                  <Revealable value={profile.email} />
                </dd>
              </div>
            )}

            {profile?.sub && (
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-gryt-muted">Gryt ID</dt>
                <dd className="m-0 text-sm text-gryt-text">
                  <Revealable value={profile.sub} />
                </dd>
              </div>
            )}

            {formatDate(profile?.createdAt) && (
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-gryt-muted">Registered</dt>
                <dd className="m-0 text-sm text-gryt-text">{formatDate(profile?.createdAt)}</dd>
              </div>
            )}
          </dl>

          <span className="text-xs">
            Servers you joined before signing in came with you — your roles and
            anything you own moved to this account the next time you connected.
          </span>

          <Button size="small"
            style={{ alignSelf: "flex-start" }}
            onClick={() => void logout()}
          >
            <PiSignOutFill size={16} />
            Sign out
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">
                Not signed in
              </span>
              <Chip tone="warning" label="No account" />
            </div>
            <span className="text-xs">
              Gryt works without an account. What one adds is a way back in: an
              identity that survives losing this device, and the same you on
              every server rather than a separate one each time.
            </span>
          </div>

          <Alert severity="info">
            <span className="inline-flex items-start gap-2">
              <PiInfoFill className="mt-0.5 shrink-0" size={15} />
              Signing in keeps the servers you have already joined. They move to
              your account the next time you connect to each one.
            </span>
          </Alert>

          <Button size="small"
            data-tour="account-signin"
            disabled={loginInProgress}
            style={{ alignSelf: "flex-start" }}
            onClick={() => void login()}
          >
            {loginInProgress
              ? "Waiting for sign in…"
              : isCustom
                ? "Sign in with your own auth"
                : "Sign in with Gryt"}
          </Button>
        </div>
      )}

      {/*
        Advanced, because it is only meaningful to somebody running their own
        Keycloak, and getting it wrong locks you out of signing in with a
        message about certificates. Cyan matches every other advanced setting.
      */}
      {showAdvanced && (
      <div className="flex flex-col gap-2">
        <span className="font-medium text-sm" color="cyan">
          Auth server
        </span>
        <span className="text-xs">
          Where accounts come from. Leave this alone unless you run your own
          Keycloak — the address of its realm, not the server root.
        </span>
        <TextField
          placeholder={DEFAULT_ISSUER}
          value={issuerInput}
          onChange={(e) => {
            setIssuerInput(e.target.value);
            setSavedIssuer(false);
          }}
        />

        <span className="text-xs">
          And the identity service that signs certificates for it. It is a
          separate service, so it cannot be worked out from the address above.
        </span>
        <TextField
          placeholder={DEFAULT_IDENTITY}
          value={identityInput}
          onChange={(e) => {
            setIdentityInput(e.target.value);
            setSavedIssuer(false);
          }}
        />

        <div className="flex gap-2 flex-wrap">
          <Button size="small" onClick={handleSaveIssuer}>
            {savedIssuer ? "Saved" : "Use these"}
          </Button>
          {hasCustom && (
            <Button size="small" onClick={handleClearIssuer}>
              Back to Gryt
            </Button>
          )}
        </div>

        {isCustom && (
          <span className="text-xs">
            A server also has to trust certificates from your identity service,
            or it will refuse the join.
          </span>
        )}
      </div>
      )}
    </SettingsContainer>
  );
}
