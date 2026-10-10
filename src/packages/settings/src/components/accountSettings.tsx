import { Alert, Button, Chip, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  type AccountProfile,
  getAccountProfile,
  resetKeycloakInit,
  startAccountDeletion,
  startEmailChange,
  startPasswordChange,
  startRecoveryCodesSetup,
  useAccount,
} from "@/common";
import { useTranslation } from "@/i18n";

import {
  getCustomAuthIssuer,
  getCustomIdentityUrl,
  setCustomAuthIssuer,
  setCustomIdentityUrl,
} from "../../../../config";
import { PiEyeFill, PiInfoFill, PiSignOutFill } from "../../../../lib/icons";
import { useLinkDevice } from "../../../../lib/pairing/useLinkDevice";
import { useSettings } from "../hooks/useSettings";
import { SettingsContainer } from "./settingsComponents";

const DEFAULT_ISSUER = "https://auth.gryt.chat/realms/gryt";
const DEFAULT_IDENTITY = "https://id.gryt.chat";

/**
 * Something worth hiding until asked for. Settings gets opened while screen
 * sharing, and an email address in plain view is noticed too late.
 */
function Revealable({ value }: { value: string }) {
  const { t: tr } = useTranslation();
  const [shown, setShown] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <code className="font-mono text-xs text-gryt-muted"
        onClick={() => setShown((s) => !s)}
        title={shown ? tr("ui.clickToHide") : tr("ui.clickToReveal")}
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
  const { t: tr } = useTranslation();
  const { isSignedIn, login, logout, loginInProgress } = useAccount();
  const { showAdvanced } = useSettings();
  const { open: openLinkDevice } = useLinkDevice();
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

    // The two go together: an issuer on its own sends a token from one Keycloak
    // to another's CA, and the rejection reads as a key problem.
    if (issuer.length > 0 && identity.length === 0) {
      toast.error(
        tr("ui.setTheIdentityServiceTooYourAuthServer"),
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
        ? tr("ui.usingYourOwnAuthServerSignInTo")
        : tr("ui.backToTheGrytAuthServer"),
    );
  }, [issuerInput, identityInput, tr]);

  const handleClearIssuer = useCallback(() => {
    setIssuerInput("");
    setIdentityInput("");
    setCustomAuthIssuer(null);
    setCustomIdentityUrl(null);
    resetKeycloakInit();
    setSavedIssuer(false);
    setHasCustom(false);
    toast.success(tr("ui.backToTheGrytAuthServer"));
  }, [tr]);

  const isCustom =
    issuerInput.trim().length > 0 && issuerInput.trim() !== DEFAULT_ISSUER;

  return (
    <SettingsContainer>
      <h2 className="text-lg">
        {tr("ui.account")}
      </h2>

      {isSignedIn ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">
              {tr("ui.signedIn")}
            </span>
            <Chip tone="success" label={tr("ui.grytAccount")} />
          </div>

          <dl className="m-0 flex flex-col gap-3">
            {profile?.email && (
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-gryt-muted">{tr("ui.email")}</dt>
                <dd className="m-0 text-sm text-gryt-text">
                  <Revealable value={profile.email} />
                </dd>
              </div>
            )}

            {profile?.sub && (
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-gryt-muted">{tr("ui.grytId")}</dt>
                <dd className="m-0 text-sm text-gryt-text">
                  <Revealable value={profile.sub} />
                </dd>
              </div>
            )}

            {formatDate(profile?.createdAt) && (
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-gryt-muted">{tr("ui.registered")}</dt>
                <dd className="m-0 text-sm text-gryt-text">{formatDate(profile?.createdAt)}</dd>
              </div>
            )}
          </dl>

          <span className="text-xs">
            {tr("ui.serversYouJoinedBeforeSigningInCameWith")}
          </span>

          {/* Each of these hands off to auth.gryt.chat and comes back here.
              They run on the login pages, which are Gryt's own theme, so
              nobody lands in Keycloak's stock account console. */}
          <div className="flex flex-col gap-2">
            <span className="font-medium text-sm">{tr("ui.manageYourAccount")}</span>
            <span className="text-xs">
              {tr("ui.theseOpenAuthGrytChatAndBringYou")}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button size="small" onClick={() => void startPasswordChange()}>
                {tr("ui.changePassword")}
              </Button>
              <Button size="small" onClick={() => void startEmailChange()}>
                {tr("ui.changeEmail")}
              </Button>
              <Button size="small" onClick={() => void startRecoveryCodesSetup()}>
                {tr("ui.recoveryCodes")}
              </Button>
            </div>
          </div>

          <Button size="small"
            style={{ alignSelf: "flex-start" }}
            onClick={() => void logout()}
          >
            <PiSignOutFill size={16} />
            {tr("ui.signOut")}
          </Button>

          {/* Last, and on its own. Keycloak asks for confirmation on a page of
              its own before anything happens, so there is no second dialog
              here — one that only repeated the next screen would train people
              to click through both. */}
          <div className="flex flex-col gap-2">
            <span className="font-medium text-sm">{tr("ui.deleteYourAccount")}</span>
            <span className="text-xs">
              {tr("ui.permanentAndItCannotBeUndoneItRemoves")}
            </span>
            <Button
              size="small"
              tone="neutral"
              style={{ alignSelf: "flex-start" }}
              onClick={() => void startAccountDeletion()}
            >
              {tr("ui.deleteAccount")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">
                {tr("ui.notSignedIn")}
              </span>
              <Chip tone="warning" label={tr("ui.noAccount")} />
            </div>
            <span className="text-xs">
              {tr("ui.grytWorksWithoutAnAccountWhatOneAdds")}
            </span>
          </div>

          <Alert severity="info">
            <span className="inline-flex items-start gap-2">
              <PiInfoFill className="mt-0.5 shrink-0" size={15} />
              {tr("ui.signingInKeepsTheServersYouHaveAlready")}
            </span>
          </Alert>

          <Button size="small"
            data-tour="account-signin"
            disabled={loginInProgress}
            style={{ alignSelf: "flex-start" }}
            onClick={() => void login()}
          >
            {loginInProgress
              ? tr("ui.waitingForSignIn")
              : isCustom
                ? tr("ui.signInWithYourOwnAuth")
                : tr("ui.signInWithGryt")}
          </Button>

          <div className="flex flex-col gap-1">
            <span className="text-xs">
              {tr("ui.signedInOnAnotherDeviceOrUsingGryt")}
            </span>
            <Button size="small"
              tone="neutral"
              style={{ alignSelf: "flex-start" }}
              onClick={openLinkDevice}
            >
              {tr("ui.linkWithAnotherDevice")}
            </Button>
          </div>
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
          {tr("ui.authServer")}
        </span>
        <span className="text-xs">
          {tr("ui.whereAccountsComeFromLeaveThisAloneUnless")}
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
          {tr("ui.andTheIdentityServiceThatSignsCertificatesFor")}
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
            {savedIssuer ? tr("ui.saved") : tr("ui.useThese")}
          </Button>
          {hasCustom && (
            <Button size="small" onClick={handleClearIssuer}>
              {tr("ui.backToGryt")}
            </Button>
          )}
        </div>

        {isCustom && (
          <span className="text-xs">
            {tr("ui.aServerAlsoHasToTrustCertificatesFrom")}
          </span>
        )}
      </div>
      )}
    </SettingsContainer>
  );
}
