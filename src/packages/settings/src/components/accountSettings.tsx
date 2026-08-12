import {
  Badge,
  Button,
  Callout,
  Code,
  DataList,
  Flex,
  Heading,
  Text,
  TextField,
} from "@radix-ui/themes";
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
    <Flex align="center" gap="2">
      <Code
        size="1"
        variant="ghost"
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
      </Code>
      {!shown && <PiEyeFill size={13} style={{ opacity: 0.5, flexShrink: 0 }} />}
    </Flex>
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
      <Heading as="h2" size="4">
        Account
      </Heading>

      {isSignedIn ? (
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <Text weight="medium" size="2">
              Signed in
            </Text>
            <Badge size="1" color="green" variant="soft">
              Gryt account
            </Badge>
          </Flex>

          <DataList.Root size="1" orientation="vertical">
            {profile?.email && (
              <DataList.Item>
                <DataList.Label>Email</DataList.Label>
                <DataList.Value>
                  <Revealable value={profile.email} />
                </DataList.Value>
              </DataList.Item>
            )}

            {profile?.username && (
              <DataList.Item>
                <DataList.Label>Username</DataList.Label>
                <DataList.Value>{profile.username}</DataList.Value>
              </DataList.Item>
            )}

            {profile?.sub && (
              <DataList.Item>
                <DataList.Label>Gryt ID</DataList.Label>
                <DataList.Value>
                  <Revealable value={profile.sub} />
                </DataList.Value>
              </DataList.Item>
            )}

            {formatDate(profile?.createdAt) && (
              <DataList.Item>
                <DataList.Label>Registered</DataList.Label>
                <DataList.Value>{formatDate(profile?.createdAt)}</DataList.Value>
              </DataList.Item>
            )}
          </DataList.Root>

          <Text size="1" color="gray">
            Servers you joined before signing in came with you — your roles and
            anything you own moved to this account the next time you connected.
          </Text>

          <Button
            variant="soft"
            color="red"
            style={{ alignSelf: "flex-start" }}
            onClick={() => void logout()}
          >
            <PiSignOutFill size={16} />
            Sign out
          </Button>
        </Flex>
      ) : (
        <Flex direction="column" gap="3">
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
              <Text weight="medium" size="2">
                Not signed in
              </Text>
              <Badge size="1" color="amber" variant="soft">
                No account
              </Badge>
            </Flex>
            <Text size="1" color="gray">
              Gryt works without an account. What one adds is a way back in: an
              identity that survives losing this device, and the same you on
              every server rather than a separate one each time.
            </Text>
          </Flex>

          <Callout.Root size="1">
            <Callout.Icon>
              <PiInfoFill size={15} />
            </Callout.Icon>
            <Callout.Text>
              Signing in keeps the servers you have already joined. They move to
              your account the next time you connect to each one.
            </Callout.Text>
          </Callout.Root>

          <Button
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
        </Flex>
      )}

      {/*
        Advanced, because it is only meaningful to somebody running their own
        Keycloak, and getting it wrong locks you out of signing in with a
        message about certificates. Cyan matches every other advanced setting.
      */}
      {showAdvanced && (
      <Flex direction="column" gap="2">
        <Text weight="medium" size="2" color="cyan">
          Auth server
        </Text>
        <Text size="1" color="gray">
          Where accounts come from. Leave this alone unless you run your own
          Keycloak — the address of its realm, not the server root.
        </Text>
        <TextField.Root
          placeholder={DEFAULT_ISSUER}
          value={issuerInput}
          onChange={(e) => {
            setIssuerInput(e.target.value);
            setSavedIssuer(false);
          }}
        />

        <Text size="1" color="gray">
          And the identity service that signs certificates for it. It is a
          separate service, so it cannot be worked out from the address above.
        </Text>
        <TextField.Root
          placeholder={DEFAULT_IDENTITY}
          value={identityInput}
          onChange={(e) => {
            setIdentityInput(e.target.value);
            setSavedIssuer(false);
          }}
        />

        <Flex gap="2" wrap="wrap">
          <Button variant="soft" onClick={handleSaveIssuer}>
            {savedIssuer ? "Saved" : "Use these"}
          </Button>
          {hasCustom && (
            <Button variant="soft" color="gray" onClick={handleClearIssuer}>
              Back to Gryt
            </Button>
          )}
        </Flex>

        {isCustom && (
          <Text size="1" color="gray">
            A server also has to trust certificates from your identity service,
            or it will refuse the join.
          </Text>
        )}
      </Flex>
      )}
    </SettingsContainer>
  );
}
