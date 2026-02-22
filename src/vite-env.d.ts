/// <reference types="vite/client" />

declare global {
  const __APP_VERSION__: string;

  interface Window {
    __GRYT_CONFIG__?: {
      GRYT_OIDC_ISSUER?: string;
      GRYT_OIDC_REALM?: string;
      GRYT_OIDC_CLIENT_ID?: string;
    };
  }
}

export {};
