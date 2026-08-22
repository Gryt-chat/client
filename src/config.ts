export type GrytRuntimeConfig = {
  GRYT_OIDC_ISSUER?: string;
  GRYT_OIDC_REALM?: string;
  GRYT_OIDC_CLIENT_ID?: string;
  GRYT_IDENTITY_URL?: string;
  GRYT_AUTH_API?: string;
  GRYT_AUTH_CALLBACK_URL?: string;
  GRYT_REPORTS_URL?: string;
};

const CUSTOM_AUTH_KEY = 'gryt_custom_auth';
const CUSTOM_IDENTITY_KEY = 'gryt_custom_identity';

const DEFAULT_OIDC_ISSUER = 'https://auth.gryt.chat/realms/gryt';

function deriveAuthApiFromIssuer(issuer: string): string {
  const i = issuer.replace(/\/+$/, '');
  const idx = i.indexOf('/realms/');
  return idx === -1 ? i : i.slice(0, idx);
}

function deriveRealmFromIssuer(issuer: string): string {
  const i = issuer.replace(/\/+$/, '');
  const idx = i.indexOf('/realms/');
  if (idx === -1) return 'gryt';
  return i.slice(idx + '/realms/'.length).split('/')[0] || 'gryt';
}

export function getCustomAuthIssuer(): string | null {
  try {
    return localStorage.getItem(CUSTOM_AUTH_KEY);
  } catch {
    return null;
  }
}

export function setCustomAuthIssuer(issuer: string | null): void {
  try {
    if (issuer) {
      localStorage.setItem(CUSTOM_AUTH_KEY, issuer.replace(/\/+$/, ''));
    } else {
      localStorage.removeItem(CUSTOM_AUTH_KEY);
    }
  } catch {
    // localStorage not available
  }
}

/**
 * The identity service that signs certificates for the auth server above.
 *
 * Kept separate rather than derived, because it is a different service on a
 * different host — `id.gryt.chat` next to `auth.gryt.chat`, and whatever a
 * self-hoster runs next to their own Keycloak. There is nothing in an issuer
 * URL to derive it from.
 *
 * Pointing at another Keycloak without also moving this is what GRYT-156 was:
 * the token came from the custom issuer and was posted to Gryt's certificate
 * authority, which validates against its own configured issuer and rejects it.
 * The 401 says "no applicable key found in the JWKS", which describes the
 * symptom and not the cause.
 */
export function getCustomIdentityUrl(): string | null {
  try {
    return localStorage.getItem(CUSTOM_IDENTITY_KEY);
  } catch {
    return null;
  }
}

export function setCustomIdentityUrl(url: string | null): void {
  try {
    if (url) {
      localStorage.setItem(CUSTOM_IDENTITY_KEY, url.replace(/\/+$/, ''));
    } else {
      localStorage.removeItem(CUSTOM_IDENTITY_KEY);
    }
  } catch {
    // localStorage not available
  }
}

function readWindowConfig(): GrytRuntimeConfig | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const cfg = w.__GRYT_CONFIG__;
  if (!cfg || typeof cfg !== 'object') return undefined;
  return cfg as GrytRuntimeConfig;
}

/**
 * Which of the two configuration mechanisms wins.
 *
 * There are two, and they belong to different environments. In production the
 * nginx container writes `/config.js` at startup from its own environment, and
 * no `VITE_` variable is ever set — the build has no build args for them. In
 * development nothing writes `config.js`, so the `VITE_` variables that
 * `ops/start_dev.sh` sets are the only way to configure anything.
 *
 * They were read window-first everywhere, which meant the tracked
 * `public/config.js` — holding production defaults, because production is what
 * it was written for — beat the local values in dev. A dev session signed in
 * against production Keycloak while the dev servers trusted only the local CA,
 * and the only sign of it was a 401 from the identity service complaining
 * about a key it had never seen. The token was real; it was just signed by the
 * wrong Keycloak.
 *
 * Gated on `DEV` rather than on "is a VITE_ variable set", so that adding build
 * args to the Dockerfile later cannot quietly stop the container's runtime
 * configuration from taking effect.
 */
function configValue(
  windowValue: string | undefined,
  viteValue: string | undefined,
  fallback: string,
): string {
  return import.meta.env.DEV
    ? viteValue || windowValue || fallback
    : windowValue || viteValue || fallback;
}

export function getGrytConfig(): Required<GrytRuntimeConfig> {
  const win = readWindowConfig();
  const customIssuer = getCustomAuthIssuer();

  const issuer =
    customIssuer ||
    configValue(
      win?.GRYT_OIDC_ISSUER,
      import.meta.env.VITE_GRYT_OIDC_ISSUER,
      DEFAULT_OIDC_ISSUER,
    );

  const realm =
    (customIssuer ? deriveRealmFromIssuer(customIssuer) : null) ||
    configValue(
      win?.GRYT_OIDC_REALM,
      import.meta.env.VITE_GRYT_OIDC_REALM,
      'gryt',
    );

  const clientId = configValue(
    win?.GRYT_OIDC_CLIENT_ID,
    import.meta.env.VITE_GRYT_OIDC_CLIENT_ID,
    'gryt-web',
  );

  const identityUrl =
    getCustomIdentityUrl() ||
    configValue(
      win?.GRYT_IDENTITY_URL,
      import.meta.env.VITE_GRYT_IDENTITY_URL,
      'https://id.gryt.chat',
    );

  const authApi =
    (customIssuer ? deriveAuthApiFromIssuer(customIssuer) : null) ||
    configValue(
      win?.GRYT_AUTH_API,
      import.meta.env.VITE_GRYT_AUTH_API,
      'https://auth.gryt.chat',
    );

  const authCallbackUrl = configValue(
    win?.GRYT_AUTH_CALLBACK_URL,
    import.meta.env.VITE_GRYT_AUTH_CALLBACK_URL,
    'https://gryt.chat/auth/callback',
  );

  /**
   * Where bug reports and feedback go.
   *
   * Not something a self-hoster points elsewhere: `reports.gryt.chat` is Gryt
   * the product's inbox rather than part of a Gryt server, and nothing on a
   * server's configuration reaches it. Configurable anyway because a dev box
   * wants a local one, and because the web container has no build step to bake
   * anything into.
   *
   * There was a `GRYT_REPORTS_APP_KEY` beside this. GRYT-529 took it out at the
   * service, so nothing reads the header any more.
   */
  const reportsUrl = configValue(
    win?.GRYT_REPORTS_URL,
    import.meta.env.VITE_GRYT_REPORTS_URL,
    'https://reports.gryt.chat',
  );

  return {
    GRYT_OIDC_ISSUER: issuer,
    GRYT_OIDC_REALM: realm,
    GRYT_OIDC_CLIENT_ID: clientId,
    GRYT_IDENTITY_URL: identityUrl,
    GRYT_AUTH_API: authApi,
    GRYT_AUTH_CALLBACK_URL: authCallbackUrl,
    GRYT_REPORTS_URL: reportsUrl,
  };
}

