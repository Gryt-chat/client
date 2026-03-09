export type GrytRuntimeConfig = {
  GRYT_OIDC_ISSUER?: string;
  GRYT_OIDC_REALM?: string;
  GRYT_OIDC_CLIENT_ID?: string;
  GRYT_IDENTITY_URL?: string;
  GRYT_AUTH_API?: string;
  GRYT_AUTH_CALLBACK_URL?: string;
};

const CUSTOM_AUTH_KEY = 'gryt_custom_auth';

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

function readWindowConfig(): GrytRuntimeConfig | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const cfg = w.__GRYT_CONFIG__;
  if (!cfg || typeof cfg !== 'object') return undefined;
  return cfg as GrytRuntimeConfig;
}

export function getGrytConfig(): Required<GrytRuntimeConfig> {
  const win = readWindowConfig();
  const customIssuer = getCustomAuthIssuer();

  const issuer =
    customIssuer ||
    win?.GRYT_OIDC_ISSUER ||
    import.meta.env.VITE_GRYT_OIDC_ISSUER ||
    DEFAULT_OIDC_ISSUER;

  const realm =
    (customIssuer ? deriveRealmFromIssuer(customIssuer) : null) ||
    win?.GRYT_OIDC_REALM ||
    import.meta.env.VITE_GRYT_OIDC_REALM ||
    'gryt';

  const clientId =
    win?.GRYT_OIDC_CLIENT_ID ||
    import.meta.env.VITE_GRYT_OIDC_CLIENT_ID ||
    'gryt-web';

  const identityUrl =
    win?.GRYT_IDENTITY_URL ||
    import.meta.env.VITE_GRYT_IDENTITY_URL ||
    'https://id.gryt.chat';

  const authApi =
    (customIssuer ? deriveAuthApiFromIssuer(customIssuer) : null) ||
    win?.GRYT_AUTH_API ||
    import.meta.env.VITE_GRYT_AUTH_API ||
    'https://auth.gryt.chat';

  const authCallbackUrl =
    win?.GRYT_AUTH_CALLBACK_URL ||
    import.meta.env.VITE_GRYT_AUTH_CALLBACK_URL ||
    'https://gryt.chat/auth/callback';

  return {
    GRYT_OIDC_ISSUER: issuer,
    GRYT_OIDC_REALM: realm,
    GRYT_OIDC_CLIENT_ID: clientId,
    GRYT_IDENTITY_URL: identityUrl,
    GRYT_AUTH_API: authApi,
    GRYT_AUTH_CALLBACK_URL: authCallbackUrl,
  };
}

