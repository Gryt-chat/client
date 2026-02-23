/// <reference types="vite/client" />
/// <reference types="react" />

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

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLAttributes<T> {
    inert?: boolean;
  }
}

export {};
