export type GrytRuntimeConfig = {
  GRYT_OIDC_ISSUER?: string;
  GRYT_OIDC_REALM?: string;
  GRYT_OIDC_CLIENT_ID?: string;
};

function readWindowConfig(): GrytRuntimeConfig | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const cfg = w.__GRYT_CONFIG__;
  if (!cfg || typeof cfg !== 'object') return undefined;
  return cfg as GrytRuntimeConfig;
}

export function getGrytConfig(): Required<GrytRuntimeConfig> {
  const win = readWindowConfig();

  const issuer =
    win?.GRYT_OIDC_ISSUER ||
    import.meta.env.VITE_GRYT_OIDC_ISSUER ||
    'https://auth.gryt.chat/realms/gryt';

  const realm =
    win?.GRYT_OIDC_REALM ||
    import.meta.env.VITE_GRYT_OIDC_REALM ||
    'gryt';

  const clientId =
    win?.GRYT_OIDC_CLIENT_ID ||
    import.meta.env.VITE_GRYT_OIDC_CLIENT_ID ||
    'gryt-web';

  return {
    GRYT_OIDC_ISSUER: issuer,
    GRYT_OIDC_REALM: realm,
    GRYT_OIDC_CLIENT_ID: clientId,
  };
}

