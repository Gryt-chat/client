// Message encryption is one implementation shared with the mobile app
// (GRYT-732). These were files in `src/auth` until the package existed, and are
// re-exported one for one so nothing in the client had to change its imports.
//
// Taken by subpath rather than as `export * from "@gryt/crypto"`, because the
// package's own `peer-keys` exports the same names as `./src/auth/peer-keys`
// below with the store spelled out. Two star exports of one name is ambiguous,
// and TypeScript drops the name rather than complaining — every call site would
// stop compiling with nothing saying why.
export * from "@gryt/crypto/attachments";
export * from "@gryt/crypto/comparison-code";
export * from "@gryt/crypto/conversation-encryption";
export * from "@gryt/crypto/dm-key-binding";
export * from "@gryt/crypto/dm-keys";
export * from "@gryt/crypto/member-keys";
export * from "@gryt/crypto/message-keys";
// Not `@gryt/crypto/thumbprint`. `server-pins.ts` has exported `jwkThumbprint`
// since GRYT-51 and is the copy the client's server pinning calls.

export * from "./src/auth/account-api";
export * from "./src/auth/answer-challenge";
export * from "./src/auth/device-delegation";
export * from "./src/auth/guest-history";
export * from "./src/auth/identity-backup-lock";
export * from "./src/auth/identity-certificate";
export * from "./src/auth/identity-claims";
export * from "./src/auth/identity-keys";
export * from "./src/auth/identity-source";
export * from "./src/auth/keycloak";
export * from "./src/auth/local-identity";
export * from "./src/auth/peer-keys";
export * from "./src/auth/server-pins";
export * from "./src/auth/session-expired";
export * from "./src/components/GeneratedServerIcon";
export * from "./src/components/logo";
export * from "./src/components/ServerErrorToast";
export * from "./src/components/wordmark";
export * from "./src/hooks/singletonHook";
export * from "./src/hooks/SingletonHooks";
export * from "./src/hooks/useAccount";
export * from "./src/hooks/useCustomThemes";
export * from "./src/hooks/useTheme";
export * from "./src/hooks/useThemeEditor";
export * from "./src/hooks/useUnreadBadge";
export * from "./src/hooks/useUnreadTracker";
export * from "./src/hooks/useUserId";
export * from "./src/hooks/useZoomShortcuts";
export * from "./src/types/account";
export * from "./src/utils/auth";
export * from "./src/utils/avatarStore";
export * from "./src/utils/betaBuild";
export * from "./src/utils/imageCompress";
export * from "./src/utils/invite";
export * from "./src/utils/preLoginUrl";
export * from "./src/utils/shareableHost";
export * from "./src/utils/tokenStorage";
export * from "./src/utils/url";
export * from "./src/utils/wornStore";

// Legacy API (deprecated by Keycloak but still present)
export * from "./src/api/auth";
export * from "./src/utils/generatedAvatar";
