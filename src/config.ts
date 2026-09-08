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
 * The identity service that signs certificates for the auth server above. Moving
 * one without the other gives "no applicable key found in the JWKS" (GRYT-156).
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
 * Which of the two configuration mechanisms wins. Read window-first, production's
 * `/config.js` beat local values. **Gated on `DEV`, not on a set `VITE_`.**
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
   * Where bug reports and feedback go. Not something a self-hoster points
   * elsewhere; configurable anyway because a dev box wants a local one.
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

