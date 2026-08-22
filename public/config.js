// Runtime config for the Gryt web client.
// - In development (vite), this file is served from /public.
// - In production (nginx container), this file is generated at container startup.
window.__GRYT_CONFIG__ = {
  GRYT_OIDC_ISSUER: "https://auth.gryt.chat/realms/gryt",
  GRYT_OIDC_REALM: "gryt",
  GRYT_OIDC_CLIENT_ID: "gryt-web",
  GRYT_AUTH_API: "https://auth.gryt.chat",
  GRYT_AUTH_CALLBACK_URL: "https://gryt.chat/auth/callback",
  GRYT_REPORTS_URL: "https://reports.gryt.chat",
  // Empty here on purpose. This file is what the dev server serves, and a key
  // in it would be a key in the repository for no gain — the container writes
  // its own from the environment. See src/lib/reports/config.ts.
  GRYT_REPORTS_APP_KEY: "",
};

