import type { DeviceTokenPoll, PairingFetch, PairingOidc } from "@gryt/core";

/* The two RFC 8628 calls against Keycloak, for the account half of linking (GRYT-1484).
   Core makes the PKCE verifier and the nonce; this only speaks the wire format. */

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

const endpoint = (issuer: string, path: string) => `${issuer.replace(/\/+$/, "")}/protocol/openid-connect/${path}`;

async function postForm(fetch: PairingFetch, url: string, form: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json: json ?? {} };
}

const text = (v: unknown) => (typeof v === "string" ? v : "");
const seconds = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

export function createPairingOidc(fetch: PairingFetch): PairingOidc {
  return {
    async deviceAuthorization(req) {
      const { status, json } = await postForm(fetch, endpoint(req.issuer, "auth/device"), {
        client_id: req.clientId,
        scope: req.scope,
        code_challenge: req.codeChallenge,
        code_challenge_method: req.codeChallengeMethod,
        nonce: req.nonce,
      });
      const deviceCode = text(json.device_code);
      const userCode = text(json.user_code);
      if (status !== 200 || !deviceCode || !userCode) {
        throw new Error(`Keycloak refused the device authorization: ${status} ${text(json.error) || "no code"}`);
      }
      return { deviceCode, userCode, expiresIn: seconds(json.expires_in) ?? 300, interval: seconds(json.interval) };
    },

    async deviceToken(req): Promise<DeviceTokenPoll> {
      let reply: Awaited<ReturnType<typeof postForm>>;
      try {
        reply = await postForm(fetch, endpoint(req.issuer, "token"), {
          grant_type: DEVICE_GRANT,
          client_id: req.clientId,
          device_code: req.deviceCode,
          code_verifier: req.codeVerifier,
        });
      } catch {
        // A dropped request is asked again on the next interval, the same as "not yet".
        return { status: "pending" };
      }
      const { status, json } = reply;
      if (status === 200) {
        const idToken = text(json.id_token);
        const accessToken = text(json.access_token);
        if (!idToken || !accessToken) return { status: "denied" };
        return {
          status: "ok",
          tokens: {
            idToken,
            accessToken,
            refreshToken: text(json.refresh_token) || undefined,
            expiresIn: seconds(json.expires_in),
          },
        };
      }
      switch (json.error) {
        case "authorization_pending":
          return { status: "pending" };
        case "slow_down":
          return { status: "slow_down" };
        case "expired_token":
          return { status: "expired" };
        default:
          return status >= 500 ? { status: "pending" } : { status: "denied" };
      }
    },
  };
}
